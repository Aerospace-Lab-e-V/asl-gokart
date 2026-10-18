//! Read-only HTTP API for the pit wall. Serves the recent past of a session so the
//! live charts start full on page load; everything after that comes over MQTT.
//! Never writes: ingest owns the schema and the data.

mod db;

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use clap::Parser;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Postgres/TimescaleDB connection string (a read-only role is enough).
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    #[arg(long, env = "LISTEN", default_value = "0.0.0.0:8081")]
    listen: SocketAddr,
}

/// Longest history a request may ask for: the pit wall's 10 min window plus margin.
const MAX_HISTORY: chrono::TimeDelta = chrono::TimeDelta::minutes(15);
/// History when `since_us` is not given.
const DEFAULT_HISTORY: chrono::TimeDelta = chrono::TimeDelta::minutes(5);

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let args = Args::parse();

    // Lazy: start serving even while the database is still coming up.
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect_lazy(&args.database_url)
        .context("parsing DATABASE_URL")?;

    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .with_context(|| format!("binding {}", args.listen))?;
    info!(listen = %args.listen, "serving");
    axum::serve(listener, router(pool))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn router(pool: PgPool) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route(
            "/api/karts/{kart_id}/sessions/{session_id}/samples",
            get(samples),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(pool)
}

#[derive(Deserialize)]
struct SamplesQuery {
    /// Unix time in microseconds; clamped to at most 15 min ago.
    since_us: Option<i64>,
    /// Comma-separated signal ids; all signals when absent.
    signals: Option<String>,
}

/// Columnar per signal, keyed by signal id: compact JSON and directly chartable.
#[derive(Serialize, Debug, Default, PartialEq)]
struct SamplesResponse {
    signals: BTreeMap<String, Columns>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
struct Columns {
    t_us: Vec<i64>,
    v: Vec<f64>,
}

async fn samples(
    State(pool): State<PgPool>,
    Path((kart_id, session_id)): Path<(String, Uuid)>,
    Query(q): Query<SamplesQuery>,
) -> Result<Response, AppError> {
    let since = clamp_since(q.since_us, Utc::now());
    let signals = parse_signals(q.signals.as_deref()).map_err(AppError::BadRequest)?;
    let rows = db::samples(&pool, &kart_id, session_id, since, signals.as_deref()).await?;
    let body = Json(to_columns(rows));
    // Always the current state of the database; never cache.
    Ok(([(header::CACHE_CONTROL, "no-store")], body).into_response())
}

fn clamp_since(since_us: Option<i64>, now: DateTime<Utc>) -> DateTime<Utc> {
    let earliest = now - MAX_HISTORY;
    since_us
        .and_then(DateTime::<Utc>::from_timestamp_micros)
        .unwrap_or(now - DEFAULT_HISTORY)
        .max(earliest)
}

fn parse_signals(raw: Option<&str>) -> Result<Option<Vec<i32>>, String> {
    let Some(raw) = raw.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    raw.split(',')
        .map(|s| {
            s.trim()
                .parse::<i32>()
                .map_err(|_| format!("invalid signal id {s:?}"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

/// Rows arrive sorted by signal, then time; group them into columns.
fn to_columns(rows: Vec<db::Row>) -> SamplesResponse {
    let mut out = SamplesResponse::default();
    for (signal_id, time, value) in rows {
        let cols = out.signals.entry(signal_id.to_string()).or_default();
        cols.t_us.push(time.timestamp_micros());
        cols.v.push(value);
    }
    out
}

enum AppError {
    BadRequest(String),
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
            Self::Internal(e) => {
                error!("request failed: {e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
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
    info!("shutting down");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(us: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp_micros(us).unwrap()
    }

    #[test]
    fn since_defaults_and_is_clamped() {
        let now = at(1_700_000_000_000_000);
        assert_eq!(clamp_since(None, now), now - DEFAULT_HISTORY);
        let recent = now - chrono::TimeDelta::minutes(2);
        assert_eq!(clamp_since(Some(recent.timestamp_micros()), now), recent);
        assert_eq!(clamp_since(Some(0), now), now - MAX_HISTORY);
    }

    #[test]
    fn signals_parse() {
        assert_eq!(parse_signals(None), Ok(None));
        assert_eq!(parse_signals(Some("")), Ok(None));
        assert_eq!(parse_signals(Some("101, 204")), Ok(Some(vec![101, 204])));
        assert!(parse_signals(Some("101,x")).is_err());
    }

    #[test]
    fn rows_group_into_columns() {
        let rows = vec![(101, at(1), 48.0), (101, at(2), 48.1), (204, at(1), 12.0)];
        let out = to_columns(rows);
        assert_eq!(out.signals.len(), 2);
        assert_eq!(out.signals["101"].t_us, vec![1, 2]);
        assert_eq!(out.signals["101"].v, vec![48.0, 48.1]);
        assert_eq!(out.signals["204"].v, vec![12.0]);
    }
}
