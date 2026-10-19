-- The refresh policy from 0002 left buckets_per_batch at its default, so every run
-- walked the whole 1-day window in 10-bucket (10 s) batches: ~6000 batches per run,
-- scheduled every 30 s, i.e. refreshing non-stop. Its first run also stalled live
-- inserts for several seconds. One batch per hour of 1 s buckets keeps a full pass
-- at <= 24 batches.

SELECT remove_continuous_aggregate_policy('samples_1s');

SELECT add_continuous_aggregate_policy('samples_1s',
    start_offset      => INTERVAL '1 day',
    end_offset        => INTERVAL '10 seconds',
    schedule_interval => INTERVAL '30 seconds',
    buckets_per_batch => 3600);
