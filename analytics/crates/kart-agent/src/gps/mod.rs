//! The GPS provider: a u-blox 6 receiver on USB (Navilock NL-602U).
//!
//! It waits for the serial device, configures the receiver (rate, automotive model,
//! only RMC/GGA/GSA; see [`ubx`]), reads it on a blocking thread and turns every
//! navigation solution into catalog samples stamped with the receive time (see
//! [`epoch`]). It reopens the device when it is unplugged or goes quiet. GPS time is
//! not used for the system clock.

pub mod epoch;
pub mod framer;
pub mod ubx;

use std::{
    io::{Read, Write},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::json;
use telemetry_schema::v1::Sample;
use tokio::sync::{mpsc, watch};
use tracing::{info, warn};

use crate::{
    config,
    log::LogHandle,
    status::{GpsStatus, Shared},
};
use epoch::Assembler;
use framer::{Frame, Framer};

const BY_ID: &str = "/dev/serial/by-id";
const BY_ID_PREFIX: &str = "usb-u-blox";
const DEVICE_RETRY: Duration = Duration::from_secs(2);
const CHECK_EVERY: Duration = Duration::from_secs(1);
/// At 1–5 Hz a healthy receiver is never this quiet.
const STALE: Duration = Duration::from_secs(3);
const ACK_TIMEOUT: Duration = Duration::from_secs(2);
/// How often the reader thread looks at its stop flag.
const READ_TIMEOUT: Duration = Duration::from_millis(200);
/// Ignored by USB CDC-ACM receivers; the u-blox default for a real UART.
const BAUD: u32 = 9600;

enum ReaderEvent {
    Frames { frames: Vec<Frame>, rx_us: i64 },
    Failed(String),
}

pub struct Provider {
    cfg: config::Gps,
    shared: Arc<Shared>,
    sink: mpsc::Sender<Vec<Sample>>,
    log: LogHandle,
    status: GpsStatus,
    assembler: Assembler,
    queue_full: Arc<AtomicU64>,
    framer_errors: Arc<AtomicU64>,
}

impl Provider {
    pub fn new(
        cfg: config::Gps,
        shared: Arc<Shared>,
        sink: mpsc::Sender<Vec<Sample>>,
        log: LogHandle,
    ) -> Self {
        let status = GpsStatus {
            state: "starting".into(),
            device: (!cfg.device.is_empty()).then(|| cfg.device.clone()),
            rate_hz: cfg.rate_hz,
            ..Default::default()
        };
        Self {
            cfg,
            shared,
            sink,
            log,
            status,
            assembler: Assembler::default(),
            queue_full: Arc::new(AtomicU64::new(0)),
            framer_errors: Arc::new(AtomicU64::new(0)),
        }
    }

    pub async fn run(mut self, mut stop: watch::Receiver<bool>) {
        if !self.cfg.enabled {
            self.set_state("disabled", None);
            return;
        }
        loop {
            let Some(device) = self.wait_for_device(&mut stop).await else {
                return;
            };
            let port = match serialport::new(&device, BAUD).timeout(READ_TIMEOUT).open() {
                Ok(p) => p,
                Err(e) => {
                    warn!(%device, "opening the GPS: {e}");
                    self.set_state("error", Some(format!("{device}: {e}")));
                    if sleep_or_stop(DEVICE_RETRY, &mut stop).await {
                        return;
                    }
                    continue;
                }
            };
            info!(%device, "GPS connected");
            self.log
                .event("gps.connected", json!({ "device": &device }));
            self.status.device = Some(device.clone());
            self.status.configured = false;
            self.set_state("configuring", None);

            let commands = ubx::configuration(self.cfg.rate_hz);
            let mut unacked: Vec<(u8, u8, &'static str)> =
                commands.iter().map(|c| (c.class, c.id, c.name)).collect();
            let mut rejected: Vec<&'static str> = Vec::new();
            let config_bytes: Vec<u8> = commands.iter().flat_map(|c| c.bytes.clone()).collect();

            let (tx, mut rx) = mpsc::channel(256);
            let stop_reader = Arc::new(AtomicBool::new(false));
            let reader = {
                let stop_reader = stop_reader.clone();
                let queue_full = self.queue_full.clone();
                let framer_errors = self.framer_errors.clone();
                thread::Builder::new()
                    .name("gps-reader".into())
                    .spawn(move || {
                        read_loop(
                            port,
                            config_bytes,
                            tx,
                            stop_reader,
                            queue_full,
                            framer_errors,
                        )
                    })
            };
            let reader = match reader {
                Ok(r) => r,
                Err(e) => {
                    self.set_state("error", Some(format!("starting the reader: {e}")));
                    if sleep_or_stop(DEVICE_RETRY, &mut stop).await {
                        return;
                    }
                    continue;
                }
            };

            let opened = Instant::now();
            let mut last_rx = Instant::now();
            let mut check = tokio::time::interval(CHECK_EVERY);
            let stopping = loop {
                tokio::select! {
                    event = rx.recv() => match event {
                        Some(ReaderEvent::Frames { frames, rx_us }) => {
                            last_rx = Instant::now();
                            for frame in frames {
                                self.handle(frame, rx_us, &mut unacked, &mut rejected).await;
                            }
                        }
                        Some(ReaderEvent::Failed(e)) => {
                            warn!(%device, "reading the GPS: {e}");
                            self.status.error = Some(e);
                            break false;
                        }
                        None => break false,
                    },
                    _ = check.tick() => {
                        if last_rx.elapsed() > STALE {
                            warn!(%device, "no data from the GPS for {STALE:?}, reopening");
                            self.status.error = Some(format!("no data for {} s", STALE.as_secs()));
                            break false;
                        }
                        if self.status.state == "configuring"
                            && (unacked.is_empty() || opened.elapsed() > ACK_TIMEOUT)
                        {
                            self.finish_configuring(&unacked, &rejected);
                        }
                        self.publish();
                    }
                    _ = stop.changed() => break true,
                }
            };

            stop_reader.store(true, Ordering::Relaxed);
            let _ = tokio::task::spawn_blocking(move || reader.join()).await;
            self.assembler.reset();
            self.status.fix = epoch::fix::NONE;
            self.status.satellites = 0;
            self.status.hdop = None;
            if stopping {
                self.set_state("stopped", None);
                return;
            }
            self.log.event(
                "gps.lost",
                json!({ "device": &device, "error": &self.status.error }),
            );
            let error = self.status.error.take();
            self.set_state("error", error);
            if sleep_or_stop(DEVICE_RETRY, &mut stop).await {
                return;
            }
        }
    }

    async fn wait_for_device(&mut self, stop: &mut watch::Receiver<bool>) -> Option<String> {
        loop {
            if let Some(device) = resolve_device(&self.cfg.device) {
                return Some(device);
            }
            if self.status.state != "waiting_for_device" {
                info!(device = %self.cfg.device, "waiting for the GPS");
            }
            self.status.device = (!self.cfg.device.is_empty()).then(|| self.cfg.device.clone());
            self.set_state("waiting_for_device", None);
            if sleep_or_stop(DEVICE_RETRY, stop).await {
                return None;
            }
        }
    }

    async fn handle(
        &mut self,
        frame: Frame,
        rx_us: i64,
        unacked: &mut Vec<(u8, u8, &'static str)>,
        rejected: &mut Vec<&'static str>,
    ) {
        match frame {
            Frame::Nmea(line) => {
                let Some(epoch) = self.assembler.push(&line, rx_us) else {
                    return;
                };
                self.status.epochs += 1;
                self.status.fix = epoch.fix;
                self.status.satellites = epoch.satellites;
                self.status.hdop = epoch.hdop;
                if epoch.lat.is_some() {
                    self.status.last_fix_us = Some(epoch.t_us);
                }
                let _ = self.sink.send(epoch.samples()).await;
            }
            Frame::Ubx { class, id, payload } => {
                let Some((class, id, acked)) = ubx::parse_ack(class, id, &payload) else {
                    return;
                };
                if let Some(i) = unacked.iter().position(|&(c, m, _)| (c, m) == (class, id)) {
                    let (_, _, name) = unacked.remove(i);
                    if !acked {
                        rejected.push(name);
                    }
                }
            }
        }
    }

    fn finish_configuring(&mut self, unacked: &[(u8, u8, &'static str)], rejected: &[&str]) {
        let missing: Vec<&str> = unacked.iter().map(|&(_, _, n)| n).collect();
        self.status.configured = missing.is_empty() && rejected.is_empty();
        if self.status.configured {
            info!(rate_hz = self.cfg.rate_hz, "GPS configured");
        } else {
            // Keep reading: the receiver still sends NMEA at its own settings.
            warn!(?missing, ?rejected, "GPS did not accept its configuration");
        }
        self.log.event(
            "gps.configured",
            json!({ "ok": self.status.configured, "rate_hz": self.cfg.rate_hz,
                    "missing": missing, "rejected": rejected }),
        );
        self.set_state("running", None);
    }

    fn set_state(&mut self, state: &str, error: Option<String>) {
        self.status.state = state.into();
        self.status.error = error;
        self.publish();
    }

    fn publish(&mut self) {
        self.status.sentences = self.assembler.sentences;
        self.status.errors = self.assembler.errors + self.framer_errors.load(Ordering::Relaxed);
        self.status.rx_queue_full = self.queue_full.load(Ordering::Relaxed);
        if let Some(fw) = &self.assembler.firmware {
            self.status.firmware = Some(fw.clone());
        }
        let status = self.status.clone();
        self.shared.update(|s| s.gps = status);
    }
}

/// An explicit device if it exists, otherwise the first u-blox under `/dev/serial/by-id`.
fn resolve_device(configured: &str) -> Option<String> {
    if !configured.is_empty() {
        return Path::new(configured)
            .exists()
            .then(|| configured.to_owned());
    }
    let mut found: Vec<String> = std::fs::read_dir(BY_ID)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(BY_ID_PREFIX))
        })
        .filter_map(|p| p.to_str().map(str::to_owned))
        .collect();
    found.sort();
    found.into_iter().next()
}

/// Blocking: sends the configuration, then forwards frames until stopped or the port fails.
fn read_loop(
    mut port: Box<dyn serialport::SerialPort>,
    config: Vec<u8>,
    tx: mpsc::Sender<ReaderEvent>,
    stop: Arc<AtomicBool>,
    queue_full: Arc<AtomicU64>,
    framer_errors: Arc<AtomicU64>,
) {
    if let Err(e) = port.write_all(&config).and_then(|()| port.flush()) {
        let _ = tx.blocking_send(ReaderEvent::Failed(format!(
            "writing the configuration: {e}"
        )));
        return;
    }
    let mut framer = Framer::default();
    let mut buf = [0u8; 1024];
    let mut frames = Vec::new();
    while !stop.load(Ordering::Relaxed) {
        match port.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => {
                let rx_us = now_us();
                framer.push(&buf[..n], &mut frames);
                framer_errors.store(framer.errors, Ordering::Relaxed);
                if frames.is_empty() {
                    continue;
                }
                let event = ReaderEvent::Frames {
                    frames: std::mem::take(&mut frames),
                    rx_us,
                };
                match tx.try_send(event) {
                    Ok(()) => {}
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        queue_full.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => return,
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted
                ) => {}
            Err(e) => {
                let _ = tx.blocking_send(ReaderEvent::Failed(e.to_string()));
                return;
            }
        }
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
