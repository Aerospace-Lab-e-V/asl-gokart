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
