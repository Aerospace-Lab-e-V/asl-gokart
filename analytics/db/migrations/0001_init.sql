-- Base telemetry schema. Applied by `ingest` at startup (sqlx::migrate!).
-- Never edit an applied migration; add a new file instead.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Mirror of schema/signals.yaml, upserted by ingest at startup.
CREATE TABLE signals (
    id          integer PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    ecu         text NOT NULL,
    unit        text NOT NULL,
    rate_hz     double precision NOT NULL,
    min         double precision NOT NULL,
    max         double precision NOT NULL,
    description text NOT NULL DEFAULT '',
    deprecated  boolean NOT NULL DEFAULT false
);

CREATE TABLE sessions (
    session_id     uuid PRIMARY KEY,
    kart_id        text NOT NULL,
    started_at     timestamptz NOT NULL,
    last_seen_at   timestamptz NOT NULL,
    online         boolean NOT NULL DEFAULT true,
    agent_version  text,
    schema_version text
);

CREATE INDEX sessions_kart_started_idx ON sessions (kart_id, started_at DESC);

-- One row per sample. No FK to signals: keeps inserts cheap and accepts
-- signals from a newer kart-agent before ingest knows about them.
CREATE TABLE samples (
    time       timestamptz NOT NULL,
    kart_id    text NOT NULL,
    session_id uuid NOT NULL,
    seq        bigint NOT NULL,
    signal_id  integer NOT NULL,
    value      double precision NOT NULL
);

SELECT create_hypertable('samples', by_range('time', INTERVAL '1 day'));

-- Idempotency: live and backfill may deliver the same batch; duplicates are dropped.
CREATE UNIQUE INDEX samples_dedup_idx ON samples (session_id, seq, signal_id, time);

-- Live dashboards: latest values of a kart's signals.
CREATE INDEX samples_kart_signal_time_idx ON samples (kart_id, signal_id, time DESC);
