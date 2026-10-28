-- Lap timing from trackside devices (schema/proto/timing.proto): every barrier crossing,
-- counted or not, written by ingest from kart/{id}/laps.

CREATE TABLE lap_crossings (
    crossing_id     uuid PRIMARY KEY,
    device_id       text NOT NULL,
    kart_id         text NOT NULL,
    -- The kart's telemetry session at the crossing; NULL when the device did not know it.
    session_id      uuid,
    -- First beam break (device clock).
    time            timestamptz NOT NULL,
    -- Lap that starts here, 0 if none.
    lap_number      integer NOT NULL,
    -- Duration of the lap that ends here, µs-precise from the barrier.
    lap_us          bigint,
    speed_kmh       double precision NOT NULL,
    -- Verdict enum name without prefix, e.g. 'ACCEPTED', 'REJECTED_FAR'.
    verdict         text NOT NULL,
    distance_m      double precision,
    barrier_lat     double precision NOT NULL,
    barrier_lon     double precision NOT NULL,
    clock_synced    boolean NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lap_crossings_kart_time_idx ON lap_crossings (kart_id, time DESC);
CREATE INDEX lap_crossings_session_idx ON lap_crossings (session_id, time);

-- Completed laps: counted crossings that close a lap. The lap ran from
-- time - lap_us to time; lap_number is the one the previous crossing started.
CREATE VIEW laps AS
SELECT
    crossing_id,
    device_id,
    kart_id,
    session_id,
    time - make_interval(secs => lap_us / 1e6) AS started_at,
    time AS ended_at,
    lap_us,
    speed_kmh AS speed_at_end_kmh
FROM lap_crossings
WHERE verdict IN ('ACCEPTED', 'ACCEPTED_UNVERIFIED') AND lap_us IS NOT NULL;
