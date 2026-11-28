//! Samples → headunit stream, and batches → (log, live uplink).
//!
//! Every sample goes to the [`Tap`] as it arrives, for the headunit's live stream. Every
//! `live.batch_ms` the samples that arrived are packed into one `kart.telemetry.v1.Batch`
//! with the next sequence number of the session, encoded once, and the same bytes go to
//! the MCAP log and the MQTT uplink. Empty intervals produce no batch. The pipeline ends,
//! after a last flush, when every sample sender is gone.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use kart_mqtt::{Link, LinkOptions};
use prost::Message;
use telemetry_schema::v1::{Batch, Sample};
use tokio::{
    sync::{mpsc, watch},
    time::MissedTickBehavior,
};
use tracing::{info, warn};

use crate::{
    agent::VERSION,
    config::Config,
    identity::Identity,
    log::{self, LogHandle},
    session::Session,
    status::{LiveStatus, Shared},
    stream::Tap,
};

pub struct Pipeline {
    pub cfg: Config,
    pub session: Arc<Mutex<Session>>,
    pub shared: Arc<Shared>,
    pub log: LogHandle,
    pub tap: Arc<Tap>,
    /// Certificate and broker login, once enrolled (ADR-0004).
    pub identity: Option<Identity>,
    /// Extra CA for the server certificate (`live.server_ca_file`).
    pub extra_ca: Option<String>,
}

impl Pipeline {
    pub async fn run(
        self,
        mut samples: mpsc::Receiver<Vec<Sample>>,
        mut live_enabled: watch::Receiver<bool>,
    ) {
        let session_id = self.session.lock().expect("session lock").id().to_owned();
        let (mut link, mut link_error) = self.start_link(*live_enabled.borrow(), &session_id);
        let mut tick = tokio::time::interval(Duration::from_millis(self.cfg.live.batch_ms));
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut status_tick = tokio::time::interval(Duration::from_secs(1));
        let mut buffer: Vec<Sample> = Vec::new();

        loop {
            tokio::select! {
                received = samples.recv() => match received {
                    Some(s) => {
                        self.tap.push(&s);
                        buffer.extend(s);
                    }
                    None => break,
                },
                _ = tick.tick() => {
                    Shared::beat(&self.shared.pipeline_heartbeat_ms);
                    self.flush(&mut buffer, &session_id, link.as_ref());
                }
                _ = status_tick.tick() => {
                    self.publish_status(link.as_ref(), link_error.as_deref(), *live_enabled.borrow());
                }
                Ok(()) = live_enabled.changed() => {
                    let enabled = *live_enabled.borrow();
                    info!(enabled, "live uplink switched");
                    self.log.event("live.switched", serde_json::json!({ "enabled": enabled }));
                    if let Some(l) = link.take() {
                        l.shutdown(Duration::from_secs(2)).await;
                    }
                    (link, link_error) = self.start_link(enabled, &session_id);
                }
            }
        }
        self.flush(&mut buffer, &session_id, link.as_ref());
        if let Some(l) = link.take() {
            l.shutdown(Duration::from_secs(2)).await;
        }
        self.publish_status(None, None, *live_enabled.borrow());
    }

    /// The link, or why there is none.
    fn start_link(&self, enabled: bool, session_id: &str) -> (Option<Link>, Option<String>) {
        let live = &self.cfg.live;
        if !enabled || live.broker_url.is_empty() {
            return (None, None);
        }
        let mut opts = LinkOptions::new(
            &live.broker_url,
            format!("kart-agent-{}", self.cfg.kart_id),
            &self.cfg.kart_id,
            format!("kart-agent/{VERSION}"),
            session_id,
        );
        if let Some(id) = &self.identity {
            opts.client_id = id.mqtt_client_id.clone();
            opts.credentials = Some((id.mqtt_username.clone(), id.mqtt_password.clone()));
            if live.broker_url.starts_with("wss://") {
                match id.tls(self.extra_ca.as_deref()) {
                    Ok(tls) => opts.tls = Some(tls),
                    Err(e) => return (None, Some(format!("certificate unusable: {e:#}"))),
                }
            }
        } else if live.broker_url.starts_with("wss://") {
            return (None, Some("not enrolled".into()));
        }
        match Link::start(opts) {
            Ok(l) => (Some(l), None),
            Err(e) => {
                warn!("starting the live uplink: {e:#}");
                (None, Some(format!("{e:#}")))
            }
        }
    }

    fn flush(&self, buffer: &mut Vec<Sample>, session_id: &str, link: Option<&Link>) {
        if buffer.is_empty() {
            return;
        }
        for chunk in buffer.chunks(self.cfg.live.max_samples_per_batch) {
            let seq = match self.session.lock().expect("session lock").reserve_seq() {
                Ok(seq) => seq,
                Err(e) => {
                    // Without a persisted seq a restart could reuse it; drop the batch.
                    warn!("persisting the sequence number: {e}");
                    continue;
                }
            };
            let bytes = Batch {
                kart_id: self.cfg.kart_id.clone(),
                session_id: session_id.to_owned(),
                seq,
                samples: chunk.to_vec(),
            }
            .encode_to_vec();
            self.log.batch(seq, log::now_ns(), bytes.clone());
            if let Some(link) = link {
                link.publish_live(bytes);
            }
        }
        buffer.clear();
    }

    fn publish_status(&self, link: Option<&Link>, link_error: Option<&str>, enabled: bool) {
        let stats = link.map(Link::stats).unwrap_or_default();
        let error = link_error
            .map(str::to_owned)
            .or_else(|| link.and_then(Link::last_error));
        let next_seq = self.session.lock().expect("session lock").next_seq();
        let live = LiveStatus {
            enabled,
            configured: !self.cfg.live.broker_url.is_empty(),
            broker_url: self.cfg.live.broker_url.clone(),
            connected: stats.connected,
            published: stats.published,
            dropped: stats.dropped,
            last_connack_us: (stats.last_connack_us > 0).then_some(stats.last_connack_us),
            error: if enabled { error } else { None },
        };
        self.shared.update(|s| {
            s.live = live;
            s.session.next_seq = next_seq;
        });
    }
}
