-- no-transaction
-- (continuous aggregates cannot be created inside a transaction)

-- 1-second rollup for history dashboards. materialized_only = false merges in
-- raw data that has not been materialized yet, so recent sessions show up immediately.
CREATE MATERIALIZED VIEW samples_1s
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '1 second', time) AS bucket,
    kart_id,
    session_id,
    signal_id,
    avg(value) AS avg,
    min(value) AS min,
    max(value) AS max,
    count(*)   AS n
FROM samples
GROUP BY bucket, kart_id, session_id, signal_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('samples_1s',
    start_offset      => INTERVAL '1 day',
    end_offset        => INTERVAL '10 seconds',
    schedule_interval => INTERVAL '30 seconds');

-- Compress raw samples after a week. All columns of samples_dedup_idx are in
-- segmentby/orderby so late backfill into compressed chunks stays idempotent.
ALTER TABLE samples SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'session_id, signal_id',
    timescaledb.compress_orderby   = 'time DESC, seq'
);

SELECT add_compression_policy('samples', INTERVAL '7 days');
