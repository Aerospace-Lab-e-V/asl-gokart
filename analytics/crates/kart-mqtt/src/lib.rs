//! The kart side of the MQTT layout in the analytics README, shared by kart-agent
//! and kart-sim:
//!
//! - `kart/{id}/status`: retained [`Status`], online on every (re)connect, offline as
//!   last will and on a clean shutdown
//! - `kart/{id}/live`: encoded [`telemetry_schema::v1::Batch`]es at QoS 0, dropped
//!   rather than queued while the link is down

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use prost::Message;
use rumqttc::{AsyncClient, Event, LastWill, MqttOptions, NetworkOptions, Outgoing, Packet, QoS};
use telemetry_schema::v1::Status;
use tokio::task::JoinHandle;
use tracing::{info, warn};

#[derive(Debug, Clone)]
pub struct LinkOptions {
    /// `mqtt://host:port`
    pub broker_url: String,
    pub client_id: String,
    pub kart_id: String,
    /// Reported in [`Status`], e.g. `kart-agent/0.5.0`.
    pub agent_version: String,
    pub session_id: String,
    pub keep_alive: Duration,
}

impl LinkOptions {
    pub fn new(
        broker_url: impl Into<String>,
        client_id: impl Into<String>,
        kart_id: impl Into<String>,
        agent_version: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self {
            broker_url: broker_url.into(),
            client_id: client_id.into(),
            kart_id: kart_id.into(),
            agent_version: agent_version.into(),
            session_id: session_id.into(),
            keep_alive: Duration::from_secs(5),
        }
    }
}

#[derive(Debug, Default)]
struct Counters {
    connected: AtomicBool,
    published: AtomicU64,
    dropped: AtomicU64,
    last_connack_us: AtomicI64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stats {
    pub connected: bool,
    /// Live batches handed to the connection.
    pub published: u64,
    /// Live batches dropped because the link was down or its queue full.
    pub dropped: u64,
    /// Last successful (re)connect, µs since the Unix epoch; 0 if never.
    pub last_connack_us: i64,
}

/// A running connection to the broker. Must be created inside a Tokio runtime.
pub struct Link {
    client: AsyncClient,
    live_topic: String,
    status_topic: String,
    offline: Vec<u8>,
    counters: Arc<Counters>,
    conn: JoinHandle<()>,
}

/// Encoded retained status message.
pub fn status(online: bool, agent_version: &str, session_id: &str) -> Vec<u8> {
    Status {
        online,
        agent_version: agent_version.into(),
        schema_version: telemetry_schema::SCHEMA_VERSION.into(),
        session_id: session_id.into(),
    }
    .encode_to_vec()
}

impl Link {
    pub fn start(opts: LinkOptions) -> Result<Self> {
        let live_topic = telemetry_schema::live_topic(&opts.kart_id);
        let status_topic = telemetry_schema::status_topic(&opts.kart_id);
        let online = status(true, &opts.agent_version, &opts.session_id);
        let offline = status(false, &opts.agent_version, &opts.session_id);

        let mut mqtt =
            MqttOptions::parse_url(format!("{}?client_id={}", opts.broker_url, opts.client_id))
                .context("parsing broker URL")?;
        mqtt.set_keep_alive(opts.keep_alive);
        mqtt.set_last_will(LastWill::new(
            &status_topic,
            offline.clone(),
            QoS::AtLeastOnce,
            true,
        ));
        let (client, mut eventloop) = AsyncClient::new(mqtt, 100);
        // Live batches are small; without TCP_NODELAY, Nagle can hold each one back for
        // tens of milliseconds, a large share of the 250 ms latency budget.
        let mut net = NetworkOptions::new();
        net.set_tcp_nodelay(true);
        eventloop.set_network_options(net);

        let counters = Arc::new(Counters::default());
        // Drive the connection; announce ourselves on every (re)connect.
        let conn = {
            let (client, status_topic, counters) =
                (client.clone(), status_topic.clone(), counters.clone());
            tokio::spawn(async move {
                loop {
                    match eventloop.poll().await {
                        Ok(Event::Incoming(Packet::ConnAck(_))) => {
                            info!("connected to broker");
                            counters.connected.store(true, Ordering::Relaxed);
                            counters.last_connack_us.store(now_us(), Ordering::Relaxed);
                            let _ = client.try_publish(
                                &status_topic,
                                QoS::AtLeastOnce,
                                true,
                                online.clone(),
                            );
                        }
                        Ok(Event::Outgoing(Outgoing::Disconnect)) => break,
                        Ok(_) => {}
                        Err(e) => {
                            counters.connected.store(false, Ordering::Relaxed);
                            warn!("MQTT connection error: {e}; retrying in 1s");
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                    }
                }
                counters.connected.store(false, Ordering::Relaxed);
            })
        };

        Ok(Self {
            client,
            live_topic,
            status_topic,
            offline,
            counters,
            conn,
        })
    }

    /// Publishes an encoded batch at QoS 0. Best effort: if the link is down or its
    /// queue is full the batch is dropped (and counted) instead of stalling or being
    /// sent late.
    pub fn publish_live(&self, payload: Vec<u8>) -> bool {
        let sent = self.counters.connected.load(Ordering::Relaxed)
            && self
                .client
                .try_publish(&self.live_topic, QoS::AtMostOnce, false, payload)
                .is_ok();
        let counter = if sent {
            &self.counters.published
        } else {
            &self.counters.dropped
        };
        counter.fetch_add(1, Ordering::Relaxed);
        sent
    }

    pub fn stats(&self) -> Stats {
        let c = &self.counters;
        Stats {
            connected: c.connected.load(Ordering::Relaxed),
            published: c.published.load(Ordering::Relaxed),
            dropped: c.dropped.load(Ordering::Relaxed),
            last_connack_us: c.last_connack_us.load(Ordering::Relaxed),
        }
    }

    /// Reports offline and disconnects. A clean disconnect suppresses the last will,
    /// so the offline status is published explicitly first.
    pub async fn shutdown(self, timeout: Duration) {
        let Self {
            client,
            status_topic,
            offline,
            conn,
            ..
        } = self;
        let bye = async {
            client
                .publish(&status_topic, QoS::AtLeastOnce, true, offline)
                .await?;
            client.disconnect().await
        };
        if let Err(e) = bye.await {
            warn!("MQTT shutdown: {e}");
        }
        if tokio::time::timeout(timeout, conn).await.is_err() {
            warn!("MQTT connection did not close within {timeout:?}");
        }
    }
}

fn now_us() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before 1970")
        .as_micros() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_carries_versions() {
        let s = Status::decode(status(true, "kart-agent/1.2.3", "sess").as_slice()).unwrap();
        assert!(s.online);
        assert_eq!(s.agent_version, "kart-agent/1.2.3");
        assert_eq!(s.schema_version, telemetry_schema::SCHEMA_VERSION);
        assert_eq!(s.session_id, "sess");
    }

    #[tokio::test]
    async fn drops_while_disconnected() {
        // Nothing listens on this port, so the link never connects.
        let link = Link::start(LinkOptions::new(
            "mqtt://127.0.0.1:9",
            "test",
            "kart-test",
            "test/0",
            "sess",
        ))
        .unwrap();
        assert!(!link.publish_live(vec![1, 2, 3]));
        let stats = link.stats();
        assert_eq!(
            (stats.connected, stats.published, stats.dropped),
            (false, 0, 1)
        );
    }
}
