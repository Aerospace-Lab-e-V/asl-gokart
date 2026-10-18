//! Fake kart: simulates a kart driving laps and publishes its telemetry over MQTT
//! exactly like kart-agent will (Protobuf batches on kart/{id}/live, retained status).

mod physics;

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use clap::Parser;
use kart_mqtt::{Link, LinkOptions};
use physics::{DriveMode, Kart, Track};
use prost::Message;
use telemetry_schema::v1::{Batch, Sample};
use tokio::time::MissedTickBehavior;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// MQTT broker URL.
    #[arg(long, env = "MQTT_URL", default_value = "mqtt://localhost:1883")]
    broker: String,

    #[arg(long, env = "KART_ID", default_value = "kart-01")]
    kart_id: String,

    /// Stop after this many seconds (default: run until Ctrl-C).
    #[arg(long, env = "SIM_DURATION_S")]
    duration: Option<u64>,

    /// Live batch interval in milliseconds.
    #[arg(long, env = "SIM_BATCH_MS", default_value_t = 50)]
    batch_ms: u64,

    #[arg(long, env = "SIM_DRIVE_MODE", value_enum, default_value_t = DriveMode::Sport)]
    drive_mode: DriveMode,

    /// Track centre latitude (placeholder location).
    #[arg(long, env = "SIM_TRACK_LAT", default_value_t = 48.0)]
    track_lat: f64,

    /// Track centre longitude (placeholder location).
    #[arg(long, env = "SIM_TRACK_LON", default_value_t = 11.0)]
    track_lon: f64,

    /// Noise seed (default: random).
    #[arg(long)]
    seed: Option<u64>,
}

/// Physics step: 100 Hz is a multiple of every catalog rate (0.5, 1, 10 Hz).
const STEP_US: i64 = 10_000;

const AGENT_VERSION: &str = concat!("kart-sim/", env!("CARGO_PKG_VERSION"));

/// A catalog signal the sim samples at its nominal rate.
struct Channel {
    id: u32,
    name: &'static str,
    period_us: i64,
    next_due_us: i64,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let args = Args::parse();

    let session_id = Uuid::now_v7().to_string();
    let seed = args.seed.unwrap_or_else(|| now_us() as u64);
    let mut kart = Kart::new(
        Track::new(args.track_lat, args.track_lon),
        args.drive_mode,
        seed,
    );
    let mut channels = channels(&mut kart);

    let link = Link::start(LinkOptions::new(
        &args.broker,
        format!("kart-sim-{}", args.kart_id),
        &args.kart_id,
        AGENT_VERSION,
        &session_id,
    ))?;

    info!(
        kart_id = %args.kart_id,
        %session_id,
        mode = ?args.drive_mode,
        signals = channels.len(),
        "driving"
    );

    let start = Instant::now();
    let start_us = now_us();
    let deadline = args.duration.map(|d| start + Duration::from_secs(d));
    let mut sim_us: i64 = 0;
    let mut seq: u64 = 0;
    let mut last_report = start;

    let mut tick = tokio::time::interval(Duration::from_millis(args.batch_ms));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = &mut shutdown => break,
        }
        if deadline.is_some_and(|d| Instant::now() >= d) {
            break;
        }

        // Advance the sim to wall-clock time and collect whatever samples fell due.
        let target_us = start.elapsed().as_micros() as i64;
        let mut samples = Vec::new();
        while sim_us + STEP_US <= target_us {
            sim_us += STEP_US;
            kart.step(STEP_US as f64 / 1e6);
            for ch in channels.iter_mut().filter(|c| sim_us >= c.next_due_us) {
                if let Some(value) = kart.measure(ch.name) {
                    samples.push(Sample {
                        signal_id: ch.id,
                        t_us: start_us + sim_us,
                        value,
                    });
                }
                ch.next_due_us += ch.period_us;
            }
        }
        if samples.is_empty() {
            continue;
        }

        let batch = Batch {
            kart_id: args.kart_id.clone(),
            session_id: session_id.clone(),
            seq,
            samples,
        };
        seq += 1;
        link.publish_live(batch.encode_to_vec());

        if last_report.elapsed() >= Duration::from_secs(10) {
            last_report = Instant::now();
            info!(
                batches = seq,
                dropped = link.stats().dropped,
                lap = kart.laps + 1,
                speed_kmh = format!("{:.1}", kart.v_mps * 3.6),
                "progress"
            );
        }
    }

    info!(
        batches = seq,
        dropped = link.stats().dropped,
        laps = kart.laps,
        "stopping"
    );
    link.shutdown(Duration::from_secs(2)).await;
    Ok(())
}

fn channels(kart: &mut Kart) -> Vec<Channel> {
    telemetry_schema::signals()
        .iter()
        .filter(|s| !s.deprecated)
        .filter(|s| {
            let simulated = kart.measure(&s.name).is_some();
            if !simulated {
                warn!(signal = %s.name, "not simulated, skipping");
            }
            simulated
        })
        .map(|s| Channel {
            id: s.id,
            name: &s.name,
            period_us: ((1e6 / s.rate_hz) as i64).max(STEP_US),
            next_due_us: 0,
        })
        .collect()
}

fn now_us() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before 1970")
        .as_micros() as i64
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
