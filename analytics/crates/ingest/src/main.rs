//! Subscribes to kart telemetry on MQTT and writes it to TimescaleDB.

mod db;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use clap::Parser;
use prost::Message;
use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, Publish, QoS};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use telemetry_schema::timing::v1::LapCrossing;
use telemetry_schema::v1::{Batch, Status};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Postgres/TimescaleDB connection string.
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    /// MQTT broker URL.
    #[arg(long, env = "MQTT_URL", default_value = "mqtt://localhost:1883")]
    mqtt_url: String,

    #[arg(long, env = "MQTT_CLIENT_ID", default_value = "ingest")]
    client_id: String,
}

/// How often a session's `last_seen_at` is written while batches keep arriving.
const SESSION_TOUCH_INTERVAL: Duration = Duration::from_secs(1);

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let args = Args::parse();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&args.database_url)
        .await
        .context("connecting to database")?;
    db::migrate(&pool).await?;
    db::sync_signals(&pool).await?;
    info!(
        signals = telemetry_schema::signals().len(),
        "database ready"
    );

    let mut opts =
        MqttOptions::parse_url(format!("{}?client_id={}", args.mqtt_url, args.client_id))
            .context("parsing MQTT_URL")?;
    opts.set_keep_alive(Duration::from_secs(5));
    let (client, eventloop) = AsyncClient::new(opts, 100);

    // Decouple the MQTT event loop from DB latency; it must keep polling to stay connected.
    let (tx, rx) = mpsc::channel::<Publish>(10_000);
    let writer = tokio::spawn(write_loop(pool, rx));

    tokio::select! {
        res = mqtt_loop(client, eventloop, tx) => res?,
        _ = shutdown_signal() => info!("shutting down"),
    }
    writer.abort();
    Ok(())
}

async fn mqtt_loop(
    client: AsyncClient,
    mut eventloop: EventLoop,
    tx: mpsc::Sender<Publish>,
) -> Result<()> {
    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                info!("connected to broker");
                // Re-subscribe on every (re)connect.
                client.subscribe("kart/+/live", QoS::AtMostOnce).await?;
                client.subscribe("kart/+/status", QoS::AtLeastOnce).await?;
                client.subscribe("kart/+/laps", QoS::AtLeastOnce).await?;
            }
            Ok(Event::Incoming(Packet::Publish(p))) => {
                if tx.try_send(p).is_err() {
                    warn!("write queue full, dropping message");
                }
            }
            Ok(_) => {}
            Err(e) => {
                error!("MQTT connection error: {e}; retrying in 1s");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

async fn write_loop(pool: PgPool, mut rx: mpsc::Receiver<Publish>) {
    let mut last_touch: HashMap<Uuid, Instant> = HashMap::new();
    while let Some(p) = rx.recv().await {
        if let Err(e) = handle(&pool, &p, &mut last_touch).await {
            error!(topic = %p.topic, "failed to handle message: {e:#}");
        }
    }
}

async fn handle(pool: &PgPool, p: &Publish, last_touch: &mut HashMap<Uuid, Instant>) -> Result<()> {
    let topic = p.topic.as_str();
    let Some(kart_id) = telemetry_schema::kart_id_from_topic(topic) else {
        return Ok(());
    };

    if topic.ends_with("/live") {
        let batch = Batch::decode(p.payload.as_ref()).context("decoding Batch")?;
        let session_id = Uuid::parse_str(&batch.session_id).context("invalid session_id")?;

        let now = Instant::now();
        let due = last_touch
            .get(&session_id)
            .is_none_or(|t| now.duration_since(*t) >= SESSION_TOUCH_INTERVAL);
        if due {
            let times = batch.samples.iter().map(|s| s.t_us);
            let first = times
                .clone()
                .min()
                .and_then(DateTime::<Utc>::from_timestamp_micros);
            let last = times.max().and_then(DateTime::<Utc>::from_timestamp_micros);
            if let (Some(first), Some(last)) = (first, last) {
                db::touch_session(pool, kart_id, session_id, first, last).await?;
            }
            last_touch.insert(session_id, now);
        }

        let inserted = db::insert_batch(pool, kart_id, session_id, &batch).await?;
        debug!(
            kart_id,
            seq = batch.seq,
            samples = batch.samples.len(),
            inserted,
            "batch"
        );
    } else if topic.ends_with("/status") {
        if p.payload.is_empty() {
            return Ok(()); // retained message cleared
        }
        let status = Status::decode(p.payload.as_ref()).context("decoding Status")?;
        let Ok(session_id) = Uuid::parse_str(&status.session_id) else {
            return Ok(());
        };
        db::update_status(pool, kart_id, session_id, &status).await?;
        info!(kart_id, %session_id, online = status.online, agent = %status.agent_version, "status");
    } else if topic.ends_with("/laps") {
        let crossing = LapCrossing::decode(p.payload.as_ref()).context("decoding LapCrossing")?;
        anyhow::ensure!(
            crossing.kart_id == kart_id,
            "crossing for kart {:?} published on {topic}",
            crossing.kart_id
        );
        let crossing_id = Uuid::parse_str(&crossing.crossing_id).context("invalid crossing_id")?;
        // Unknown when the device could not see the kart's status; the row still counts.
        let session_id = Uuid::parse_str(&crossing.kart_session_id).ok();
        let time = DateTime::<Utc>::from_timestamp_micros(crossing.t_us).context("invalid t_us")?;
        let new = db::insert_crossing(pool, kart_id, crossing_id, session_id, time, &crossing).await?;
        info!(
            kart_id,
            device = %crossing.device_id,
            verdict = crossing.verdict().as_str_name(),
            lap_us = crossing.lap_us,
            new,
            "lap crossing"
        );
    }
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).expect("installing SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}
