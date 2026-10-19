//! The Sero provider: a consumer of the zone controllers' events.
//!
//! It waits for the car network interface, runs a sero runtime on its own thread
//! (client id and port from the config, distinct from the headunit's), decodes every
//! notification into catalog samples (stamped with the receive time) and keeps the
//! per-service status. It restarts the runtime when the interface address changes or
//! the thread hangs, and re-subscribes when sero gave up on a subscription (the ECU
//! rejected it or never answered; sero does not retry on its own).

use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use ecu_sero::{Decoder, SERVICES, SUBSCRIPTIONS, decode, ids};
use serde_json::json;
use sero_sys::{Command, Event, Handler, LogLevel, Options, net};
use telemetry_schema::v1::Sample;
use tokio::sync::{mpsc, watch};
use tracing::{info, warn};

use crate::{
    config,
    log::LogHandle,
    status::{EventStatus, SeroStatus, ServiceStatus, Shared},
};

const INTERFACE_RETRY: Duration = Duration::from_secs(2);
const START_RETRY: Duration = Duration::from_secs(5);
const CHECK_EVERY: Duration = Duration::from_secs(1);
/// The sero thread polls every 10 ms; this long without a loop means it hangs.
const STALE_THREAD_MS: u32 = 5_000;

/// Copies runtime events from the sero thread into the async world.
struct Forward {
    tx: mpsc::Sender<Event>,
    queue_full: Arc<AtomicU64>,
}

impl Handler for Forward {
    fn on_event(&mut self, event: Event) {
        if matches!(&event, Event::Log(l) if l.level < LogLevel::Warn) {
            return;
        }
        if self.tx.try_send(event).is_err() {
            self.queue_full.fetch_add(1, Ordering::Relaxed);
        }
    }
}

pub fn service_name(id: u16) -> &'static str {
    match id {
        ids::LIGHTS => "lights",
        ids::BATTERY => "battery",
        ids::MOTOR => "motor",
        _ => "unknown",
    }
}

pub struct Provider {
    cfg: config::Sero,
    shared: Arc<Shared>,
    sink: mpsc::Sender<Vec<Sample>>,
    log: LogHandle,
    decoder: Decoder,
    status: SeroStatus,
    /// Per subscription: last accepted ACK and last (re)subscribe, µs since epoch.
    subs: BTreeMap<(u16, u16), (i64, i64)>,
    queue_full: Arc<AtomicU64>,
    warned_decode: std::collections::BTreeSet<(u16, u16)>,
}

impl Provider {
    pub fn new(
        cfg: config::Sero,
        vehicle: &config::Vehicle,
        shared: Arc<Shared>,
        sink: mpsc::Sender<Vec<Sample>>,
        log: LogHandle,
    ) -> Self {
        let status = SeroStatus {
            state: "starting".into(),
            interface: cfg.interface.clone(),
            client_id: cfg.client_id,
            services: SERVICES
                .iter()
                .map(|&id| ServiceStatus {
                    id,
                    name: service_name(id).into(),
                    events: SUBSCRIPTIONS
                        .iter()
                        .filter(|(s, _)| *s == id)
                        .map(|&(_, e)| EventStatus {
                            id: e,
                            ..Default::default()
                        })
                        .collect(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        Self {
            decoder: Decoder::new(vehicle.wheel_circumference_m),
            cfg,
            shared,
            sink,
            log,
            status,
            subs: BTreeMap::new(),
            queue_full: Arc::new(AtomicU64::new(0)),
            warned_decode: Default::default(),
        }
    }

    pub async fn run(mut self, mut stop: watch::Receiver<bool>) {
        loop {
            let Some(ip) = self.wait_for_interface(&mut stop).await else {
                return;
            };
            let (tx, mut rx) = mpsc::channel(4096);
            let forward = Forward {
                tx,
                queue_full: self.queue_full.clone(),
            };
            let ttl = self.cfg.subscribe_ttl_s;
            let options = Options::new(ip, self.cfg.port, self.cfg.client_id);
            let thread = match sero_sys::spawn(options, Box::new(forward), move |rt, now| {
                for &service in SERVICES {
                    rt.find(service, 1, now);
                }
                for &(service, event) in SUBSCRIPTIONS {
                    rt.subscribe(service, event, ttl, now);
                }
                Ok(())
            }) {
                Ok(t) => t,
                Err(e) => {
                    warn!(%ip, port = self.cfg.port, "starting sero: {e}");
                    self.set_state("error", Some(format!("{ip}:{}: {e}", self.cfg.port)));
                    if sleep_or_stop(START_RETRY, &mut stop).await {
                        return;
                    }
                    continue;
                }
            };
            info!(addr = %thread.local_addr(), client_id = self.cfg.client_id, "sero running");
            self.status.address = Some(thread.local_addr().to_string());
            self.set_state("running", None);
            let started = now_us();
            for &key in SUBSCRIPTIONS {
                self.subs.insert(key, (0, started));
            }

            let mut check = tokio::time::interval(CHECK_EVERY);
            let stopping = loop {
                tokio::select! {
                    Some(event) = rx.recv() => self.handle(event).await,
                    _ = check.tick() => {
                        if net::interface_ipv4(&self.cfg.interface).ok().flatten() != Some(ip) {
                            warn!(interface = %self.cfg.interface, "address changed, restarting sero");
                            break false;
                        }
                        if sero_sys::now_ms().wrapping_sub(thread.heartbeat_ms()) > STALE_THREAD_MS {
                            warn!("sero thread stopped responding, restarting it");
                            break false;
                        }
                        self.resubscribe_stale(&thread);
                        self.status.counters = sero_sys::DIAGNOSTIC_COUNTERS
                            .iter()
                            .map(|n| n.to_string())
                            .zip(thread.diagnostics())
                            .collect();
                        self.publish();
                    }
                    _ = stop.changed() => break true,
                }
            };

            if stopping {
                // Free the ECUs' subscriber slots right away instead of after the TTL.
                for &(service, event) in SUBSCRIPTIONS {
                    thread.send(Command::Unsubscribe { service, event });
                }
            }
            let _ = tokio::task::spawn_blocking(move || thread.shutdown()).await;
            for s in &mut self.status.services {
                s.found = false;
            }
            self.decoder.reset();
            if stopping {
                self.set_state("stopped", None);
                return;
            }
        }
    }

    async fn wait_for_interface(
        &mut self,
        stop: &mut watch::Receiver<bool>,
    ) -> Option<std::net::Ipv4Addr> {
        loop {
            match net::interface_ipv4(&self.cfg.interface) {
                Ok(Some(ip)) => return Some(ip),
                Ok(None) => self.set_state("waiting_for_interface", None),
                Err(e) => self.set_state("error", Some(format!("listing interfaces: {e}"))),
            }
            self.status.address = None;
            if sleep_or_stop(INTERFACE_RETRY, stop).await {
                return None;
            }
        }
    }

    async fn handle(&mut self, event: Event) {
        match event {
            Event::Notification {
                service,
                event,
                payload,
                rx_unix_us,
            } => {
                let decoded = decode(service, event, &payload);
                let ev = self.event_status(service, event);
                if let Some(ev) = ev {
                    ev.rx += 1;
                    ev.last_rx_us = Some(rx_unix_us);
                }
                match decoded {
                    Ok(Some(e)) => {
                        let mut samples = Vec::new();
                        self.decoder.push(&e, rx_unix_us, &mut samples);
                        if !samples.is_empty() {
                            let _ = self.sink.send(samples).await;
                        }
                    }
                    Ok(None) => {}
                    Err(e) => {
                        if let Some(ev) = self.event_status(service, event) {
                            ev.decode_errors += 1;
                        }
                        // Once per event: a layout mismatch would repeat at 10 Hz.
                        if self.warned_decode.insert((service, event)) {
                            warn!("cannot decode: {e}");
                            self.log
                                .event("sero.decode_error", json!({ "error": e.to_string() }));
                        }
                    }
                }
            }
            Event::ServiceFound { service, provider } => {
                info!(service = service_name(service), %provider, "ECU found");
                if let Some(s) = self.service_status(service) {
                    s.found = true;
                    s.provider = Some(provider.to_string());
                }
                self.log.event(
                    "sero.service_found",
                    json!({ "service": service, "provider": provider.to_string() }),
                );
                self.publish();
            }
            Event::ServiceLost { service } => {
                warn!(service = service_name(service), "ECU lost");
                if let Some(s) = self.service_status(service) {
                    s.found = false;
                }
                if service == ids::BATTERY {
                    self.decoder.reset();
                }
                self.log
                    .event("sero.service_lost", json!({ "service": service }));
                self.publish();
            }
            Event::SubscriptionAck {
                service,
                event,
                return_code,
                granted_ttl_s,
            } => {
                let now = now_us();
                let previous = self.event_status(service, event).and_then(|e| e.ack);
                if let Some(ev) = self.event_status(service, event) {
                    ev.ack = Some(return_code);
                    if return_code == sero_sys::rc::E_OK {
                        ev.last_ack_us = Some(now);
                    }
                }
                if return_code == sero_sys::rc::E_OK
                    && let Some(sub) = self.subs.get_mut(&(service, event))
                {
                    sub.0 = now;
                }
                // Renewals ACK every TTL/2; only changes are worth recording.
                if previous != Some(return_code) {
                    if return_code != sero_sys::rc::E_OK {
                        warn!(service, event, return_code, "subscription rejected");
                    }
                    self.log.event(
                        "sero.subscription_ack",
                        json!({ "service": service, "event_id": event,
                                "return_code": return_code, "ttl_s": granted_ttl_s }),
                    );
                    self.publish();
                }
            }
            Event::Log(l) => warn!(tag = %l.tag, service = l.service, id = l.method_event, "sero"),
            Event::CommandFailed {
                command,
                service,
                id,
            } => {
                warn!(command, service, id, "sero command failed")
            }
        }
    }

    /// A subscription is stale when its service is found but no ACK arrived for two
    /// TTLs; sero renews at TTL/2, so a healthy one is ACKed four times as often.
    fn resubscribe_stale(&mut self, thread: &sero_sys::SeroThread) {
        let now = now_us();
        let window = 2 * self.cfg.subscribe_ttl_s as i64 * 1_000_000;
        let found: Vec<u16> = self
            .status
            .services
            .iter()
            .filter(|s| s.found)
            .map(|s| s.id)
            .collect();
        for (&(service, event), (last_ack, last_try)) in &mut self.subs {
            if found.contains(&service) && now - *last_ack > window && now - *last_try > window {
                info!(service = service_name(service), event, "re-subscribing");
                thread.send(Command::Subscribe {
                    service,
                    event,
                    ttl_s: self.cfg.subscribe_ttl_s,
                });
                *last_try = now;
            }
        }
    }

    fn service_status(&mut self, id: u16) -> Option<&mut ServiceStatus> {
        self.status.services.iter_mut().find(|s| s.id == id)
    }

    fn event_status(&mut self, service: u16, event: u16) -> Option<&mut EventStatus> {
        self.service_status(service)?
            .events
            .iter_mut()
            .find(|e| e.id == event)
    }

    fn set_state(&mut self, state: &str, error: Option<String>) {
        self.status.state = state.into();
        self.status.error = error;
        self.publish();
    }

    fn publish(&mut self) {
        self.status.rx_queue_full = self.queue_full.load(Ordering::Relaxed);
        let status = self.status.clone();
        self.shared.update(|s| s.sero = status);
    }
}

/// `true` if asked to stop.
async fn sleep_or_stop(d: Duration, stop: &mut watch::Receiver<bool>) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(d) => false,
        _ = stop.changed() => true,
    }
}

fn now_us() -> i64 {
    crate::log::now_ns() as i64 / 1000
}
