use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use telemetry_schema::timing::v1::LapCrossing;
use telemetry_schema::v1::{Batch, Status};
use uuid::Uuid;

pub async fn migrate(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("../../db/migrations")
        .run(pool)
        .await
        .context("running migrations")
}

/// Mirrors schema/signals.yaml into the `signals` table.
pub async fn sync_signals(pool: &PgPool) -> Result<()> {
    let mut tx = pool.begin().await?;
    for s in telemetry_schema::signals() {
        sqlx::query(
            "INSERT INTO signals (id, name, ecu, unit, rate_hz, min, max, description, deprecated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, ecu = EXCLUDED.ecu, unit = EXCLUDED.unit,
                rate_hz = EXCLUDED.rate_hz, min = EXCLUDED.min, max = EXCLUDED.max,
                description = EXCLUDED.description, deprecated = EXCLUDED.deprecated",
        )
        .bind(s.id as i32)
        .bind(&s.name)
        .bind(&s.ecu)
        .bind(&s.unit)
        .bind(s.rate_hz)
        .bind(s.min)
        .bind(s.max)
        .bind(&s.description)
        .bind(s.deprecated)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Inserts all samples of a batch. Re-delivered batches are ignored, so this is safe
/// to call for live and backfill data alike. Returns the number of new rows.
pub async fn insert_batch(
    pool: &PgPool,
    kart_id: &str,
    session_id: Uuid,
    batch: &Batch,
) -> Result<u64> {
    let n = batch.samples.len();
    let mut times = Vec::with_capacity(n);
    let mut signal_ids = Vec::with_capacity(n);
    let mut values = Vec::with_capacity(n);
    for s in &batch.samples {
        let Some(t) = DateTime::<Utc>::from_timestamp_micros(s.t_us) else {
            continue;
        };
        times.push(t);
        signal_ids.push(s.signal_id as i32);
        values.push(s.value);
    }

    let result = sqlx::query(
        "INSERT INTO samples (time, kart_id, session_id, seq, signal_id, value)
         SELECT t, $1, $2, $3, s, v
         FROM UNNEST($4::timestamptz[], $5::int4[], $6::float8[]) AS u(t, s, v)
         ON CONFLICT DO NOTHING",
    )
    .bind(kart_id)
    .bind(session_id)
    .bind(batch.seq as i64)
    .bind(&times)
    .bind(&signal_ids)
    .bind(&values)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Creates the session on first sight and widens its time range.
pub async fn touch_session(
    pool: &PgPool,
    kart_id: &str,
    session_id: Uuid,
    first: DateTime<Utc>,
    last: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO sessions (session_id, kart_id, started_at, last_seen_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id) DO UPDATE SET
            started_at = LEAST(sessions.started_at, EXCLUDED.started_at),
            last_seen_at = GREATEST(sessions.last_seen_at, EXCLUDED.last_seen_at)",
    )
    .bind(session_id)
    .bind(kart_id)
    .bind(first)
    .bind(last)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_status(
    pool: &PgPool,
    kart_id: &str,
    session_id: Uuid,
    status: &Status,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO sessions (session_id, kart_id, started_at, last_seen_at, online, agent_version, schema_version)
         VALUES ($1, $2, now(), now(), $3, $4, $5)
         ON CONFLICT (session_id) DO UPDATE SET
            online = EXCLUDED.online,
            agent_version = EXCLUDED.agent_version,
            schema_version = EXCLUDED.schema_version",
    )
    .bind(session_id)
    .bind(kart_id)
    .bind(status.online)
    .bind(&status.agent_version)
    .bind(&status.schema_version)
    .execute(pool)
    .await?;
    Ok(())
}

/// Stores one timing-device crossing. The device resends until the broker acknowledges, so a
/// crossing can arrive twice; the second copy is ignored. Returns whether it was new.
pub async fn insert_crossing(
    pool: &PgPool,
    kart_id: &str,
    crossing_id: Uuid,
    session_id: Option<Uuid>,
    time: DateTime<Utc>,
    c: &LapCrossing,
) -> Result<bool> {
    // Store the enum name without its VERDICT_ prefix (e.g. ACCEPTED) so SQL and Grafana read it as is.
    let verdict = c.verdict().as_str_name().trim_start_matches("VERDICT_");
    let result = sqlx::query(
        "INSERT INTO lap_crossings (crossing_id, device_id, kart_id, session_id, time, lap_number,
            lap_us, speed_kmh, verdict, distance_m, barrier_lat, barrier_lon, clock_synced)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (crossing_id) DO NOTHING",
    )
    .bind(crossing_id)
    .bind(&c.device_id)
    .bind(kart_id)
    .bind(session_id)
    .bind(time)
    .bind(c.lap_number as i32)
    .bind(c.lap_us.map(|us| us as i64))
    .bind(c.speed_kmh)
    .bind(verdict)
    .bind(c.distance_m)
    .bind(c.barrier_lat)
    .bind(c.barrier_lon)
    .bind(c.clock_synced)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}
