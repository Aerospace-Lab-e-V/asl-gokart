use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// Upper bound per request, far above 15 min of every catalog signal (~150 samples/s).
const MAX_ROWS: i64 = 500_000;

/// One raw sample: (signal_id, time, value).
pub type Row = (i32, DateTime<Utc>, f64);

/// Samples of one session since `since`, sorted by signal, then time.
/// `signals: None` returns every signal. Uses `samples_kart_signal_time_idx`.
pub async fn samples(
    pool: &PgPool,
    kart_id: &str,
    session_id: Uuid,
    since: DateTime<Utc>,
    signals: Option<&[i32]>,
) -> Result<Vec<Row>> {
    let rows = sqlx::query_as::<_, Row>(
        "SELECT signal_id, time, value
         FROM samples
         WHERE kart_id = $1 AND session_id = $2 AND time >= $3
           AND ($4::int4[] IS NULL OR signal_id = ANY($4))
         ORDER BY signal_id, time
         LIMIT $5",
    )
    .bind(kart_id)
    .bind(session_id)
    .bind(since)
    .bind(signals)
    .bind(MAX_ROWS)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// One timing-device crossing, as the pit wall shows it.
#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct Crossing {
    pub crossing_id: Uuid,
    pub device_id: String,
    #[serde(serialize_with = "as_unix_us")]
    pub time: DateTime<Utc>,
    pub lap_number: i32,
    pub lap_us: Option<i64>,
    pub speed_kmh: f64,
    pub verdict: String,
    pub distance_m: Option<f64>,
    pub barrier_lat: f64,
    pub barrier_lon: f64,
    pub clock_synced: bool,
}

fn as_unix_us<S: serde::Serializer>(t: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_i64(t.timestamp_micros())
}

/// All crossings of one kart session in time order. A session holds at most a few hundred.
pub async fn crossings(pool: &PgPool, kart_id: &str, session_id: Uuid) -> Result<Vec<Crossing>> {
    let rows = sqlx::query_as::<_, Crossing>(
        "SELECT crossing_id, device_id, time, lap_number, lap_us, speed_kmh, verdict,
                distance_m, barrier_lat, barrier_lon, clock_synced
         FROM lap_crossings
         WHERE kart_id = $1 AND session_id = $2
         ORDER BY time",
    )
    .bind(kart_id)
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
