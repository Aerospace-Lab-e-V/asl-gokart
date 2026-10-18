# Kart Telemetry & Analytics

Real-time telemetry and long-term analytics for our electric go-kart. Data from the onboard ECUs is collected on the Raspberry Pi head unit, streamed live to our own infrastructure over LTE/5G, and stored for analysis. The same platform shows live data during a session and historical data across seasons, and lets authorized team members adjust vehicle parameters remotely.

> **Core principle:** the kart's local log is the source of truth. The live stream is a best-effort preview. Anything lost on the link is backfilled from the kart afterwards, so every session ends up complete in the cloud.

---

## Architecture

```
ECUs ──GbE──► Raspberry Pi (kart-agent)
                 ├─ decode proprietary ECU protocol → signals
                 ├─ write everything to local session log (always)
                 ├─ live: batch every ~50 ms → MQTT (QoS 0) ─────────┐
                 ├─ backfill: upload log chunks when the link allows ┤
                 └─ commands: subscribe, validate, apply, ack        │
                                                                     ▼
                         WireGuard tunnel over LTE/5G hotspot
                                                                     ▼
Proxmox VM (Docker Compose)
  MQTT broker ──► ingest ──► TimescaleDB ──► Grafana (history, near-live overview)
       │
       └──(MQTT over WebSocket)──► pit wall in the browser (real-time)
  command-api ◄── param-app
  Keycloak (OIDC, brokering SAML) in front of all user-facing services
```

**Latency target:** aim for ≤ 250 ms from ECU to the pit wall screen; 500 ms is the hard limit. Budget: 25–50 ms batching, 50–150 ms LTE uplink, ~5 ms WireGuard and broker, leaving tens of milliseconds for the browser to decode and render. That is why the pit wall reads MQTT directly over WebSocket. Every path through Grafana adds a database poll or a fixed flush timer, which costs 100 ms to 1 s. LTE spikes cause gaps in the live view only; backfill restores them.

---

## Tech stack

| Layer | Choice |
|---|---|
| Onboard agent | Rust (Tokio, rumqttc) on Raspberry Pi |
| Local log | MCAP session files + SQLite upload index |
| Time sync | chrony with GPS + PPS; Pi is time source for ECUs |
| Network | WireGuard (kart dials out; no open ports on the kart) |
| Transport | MQTT 5, Protobuf payloads, zstd-compressed batches |
| Broker | Mosquitto (or NanoMQ) |
| Time-series DB | TimescaleDB |
| Live view (pit wall) | Browser app, MQTT over WebSocket straight from the broker (stack TBD) |
| Dashboards | Grafana OSS on TimescaleDB (history, near-live overview) |
| Session deep dive | Lichtblick / PlotJuggler (open MCAP files directly) |
| Auth | Keycloak (OIDC to all services; upstream SAML brokered by Keycloak) |
| Platform | Docker Compose on a Proxmox VM |
| Later | Parquet archive on S3-compatible storage, analysis tooling, MediaMTX for video, LoRa fallback link (ChirpStack if LoRaWAN) |

> Grafana OSS supports OIDC but not SAML (SAML is Enterprise-only). Connect Grafana to Keycloak via OIDC; Keycloak handles any SAML identity provider upstream.

---

## Repository layout

```
analytics/
├── schema/          # Source of truth: signal catalog + protobuf definitions
│   ├── signals.yaml # name, ECU, unit, scale, rate, limits
│   ├── proto/       # telemetry.proto, commands.proto
│   └── buf.yaml     # lint + breaking-change checks
├── crates/          # Rust workspace (server crates carry their own Dockerfile)
│   ├── telemetry-schema/  # types generated from schema/
│   ├── kart-agent/        # runs on the Pi
│   ├── ingest/            # MQTT → TimescaleDB, idempotent by (session, seq)
│   ├── command-api/       # audited parameter writes
│   ├── lap-timing/        # GPS geofence → laps table
│   └── kart-sim/          # fake kart; replays recorded sessions
├── web/
│   ├── pit-wall/    # real-time live view (stack TBD)
│   └── param-app/   # TypeScript parameter UI
├── db/migrations/   # TimescaleDB schema, hypertables, continuous aggregates
├── grafana/
│   ├── dashboards/  # dashboard JSON (provisioned, read-only in prod)
│   └── provisioning/
├── deploy/
│   ├── compose/     # Docker Compose stacks
│   │   ├── compose.yml       # shared: broker, TimescaleDB, Grafana, Keycloak
│   │   ├── compose.dev.yml   # local overrides (exposed ports, dev credentials)
│   │   ├── compose.prod.yml  # prod overrides (ingest, command-api, restart policies, volumes)
│   │   ├── .env.example      # variable names only; the real .env is untracked
│   │   └── timescaledb-init/ # first-start DB setup (read-only Grafana role)
│   ├── mosquitto/   # broker config (dev: anonymous, prod: auth)
│   ├── kart/        # systemd units, Ansible for the Pi, WireGuard templates
│   ├── keycloak/    # realm export
│   └── infra/       # Proxmox VM for the Docker host via OpenTofu (optional)
└── testdata/sessions/      # small recorded sessions (Git LFS)
```

---

## Getting started (local development)

You don't need the kart to work on most of this. `kart-sim` simulates a kart driving laps on a placeholder track and publishes its telemetry through the real MQTT path. Replaying recorded sessions comes later.

**Prerequisites:** Docker (with Compose). For working on the Rust code: Rust (stable). Later: Node.js with `pnpm`, `buf`, Git LFS.

### One-command demo

Runs the whole pipeline in containers: fake kart → Mosquitto → ingest → TimescaleDB → Grafana.

```bash
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml --profile sim up --build
```

Open Grafana at http://localhost:3000 (anonymous viewer access; admin login is `admin` / `admin`).
- **Kart Live**: the home dashboard. It refreshes every second and shows the kart moving on the track map. This is a near-live overview only, about 1–2 s behind.
- **Kart Session History**: click a session in the table to open its full time range.

The real-time feed for the pit wall is at `ws://localhost:9001` (MQTT over WebSocket, anonymous in dev). See [Pit wall](#pit-wall-live-view).

Stop the stack with `Ctrl-C`. Add `down -v` to wipe the database and Grafana volumes.

### Developing ingest / kart-sim locally

```bash
# 1. Start the backend only (broker, TimescaleDB, Grafana)
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml up -d

# 2. Start ingest. It applies db/migrations automatically (sqlx) and syncs the signal catalog.
DATABASE_URL=postgres://kart:kart@localhost:5432/telemetry cargo run -p ingest

# 3. Drive a fake kart (new session per run; see --help for drive mode, duration, track position)
cargo run -p kart-sim -- --kart-id kart-01 --drive-mode sport

# Tests: catalog consistency, protobuf round trip, sim values within signals.yaml limits
cargo test --workspace
```

Useful checks:

```bash
# Raw MQTT traffic (payloads are Protobuf, so mostly binary)
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml exec mosquitto mosquitto_sub -t 'kart/#' -v

# Rows per signal
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml exec timescaledb \
  psql -U kart -d telemetry -c "SELECT s.name, count(*), max(time) FROM samples JOIN signals s ON s.id = signal_id GROUP BY 1 ORDER BY 1"
```

New signals: add them to `schema/signals.yaml` (new id, never reuse one) and to the sim in `crates/kart-sim/src/physics.rs`. No proto or DB change is needed. The tests fail if a catalog signal is not simulated or leaves its `min`/`max` range.

Parameter app:

```bash
cd web/param-app
pnpm install
pnpm dev
```

> Exact commands will be updated as each component lands.

---

## Components

### `kart-agent` (Raspberry Pi)
Decodes ECU traffic, timestamps it, and writes **everything** to the local session log first. In parallel it publishes batched live data over MQTT and uploads log chunks for backfill. It receives parameter commands, checks them against its own allowlist and ranges (never trusting the cloud alone), applies them, and acknowledges. Critical threshold alerts are evaluated here.

Built for `aarch64` with `cross` and deployed via Ansible as a systemd service (`deploy/kart/`).

### `ingest`
Subscribes to live and backfill topics and writes to TimescaleDB. Inserts are idempotent on `(session_id, seq)`, so live data and backfill can overlap safely and gaps fill in automatically.

### `command-api` + `param-app`
The only path for changing vehicle parameters. Every request is authenticated through Keycloak, authorized by role, logged (who, what, old/new value, when), published to the command topic, and only reported as successful after the kart's acknowledgment. Some parameters may only be changed while the kart is stationary.

### `lap-timing`
Detects start/finish and sector crossings from GPS using track geofences and writes the `laps` table. All lap overlays and comparisons depend on it.

### Pit wall (live view)
The real-time view for the pit area. The tech stack is not decided yet. This is the contract any implementation has to follow:

- **Connect** to the broker over MQTT on WebSocket. Dev: `ws://localhost:9001`, anonymous. Prod: `wss://` behind the reverse proxy with read-only credentials (TBD together with Keycloak). The pit wall never publishes.
- **Subscribe**
  - `kart/+/status`: retained, so you immediately learn every kart's online state, `session_id` and schema version.
  - `kart/+/live`: QoS 0.
- **Decode** with code generated from `schema/proto/telemetry.proto`, not hand-written:
  - `live` payloads are `kart.telemetry.v1.Batch`;
  - `status` payloads are `Status`.
- **Signals:** map `Sample.signal_id` through `schema/signals.yaml` (name, unit, min/max, rate). Load the catalog at build time. Ignore unknown IDs, which come from a newer kart-agent.
- **Time:** `Sample.t_us` is Unix time in microseconds from the kart clock (GPS/PPS-disciplined). Plot on that time, not on arrival time.
- **Data age:** show `now − newest t_us`. This is the live latency measurement and the way to verify the 250 ms target. The browser machine's clock must be NTP-synced.
- **Batches** arrive every ~50 ms.
  - A batch holds samples of several signals at their own rates: ~1 sample per 20 Hz signal, and a 1 Hz signal only every 20th batch.
  - `seq` increments by one per batch. A gap means a batch was lost on the link (QoS 0, expected on LTE). Don't interpolate across it. Backfill only repairs the database, not the live view.
- **Rendering:** the display path has only tens of milliseconds of budget. Buffer incoming samples, draw once per animation frame instead of once per message, and keep a bounded window (for example the last 60 s).
- **Compression:** payloads are uncompressed today. The tech stack plans zstd-compressed batches; if that lands, the browser has to decompress zstd. Factor this in when choosing the stack.

For testing without the kart, the one-command demo runs `kart-sim`, which publishes `kart/kart-01/live` and `kart/kart-01/status` through the real path.

### Grafana
Historical dashboards, track maps (Geomap) and speed-vs-distance overlays (XY chart) via TimescaleDB, plus a near-live overview polled every second. It is not the real-time view; see the pit wall above. Dashboards are code in `grafana/dashboards/`; export changes from the UI and commit them.

---

## MQTT topics (draft)

| Topic | Direction | QoS | Content |
|---|---|---|---|
| `kart/{id}/live` | kart → cloud | 0 | batched signal samples (~50 ms) |
| `kart/{id}/backfill` | kart → cloud | 1 | log chunks with sequence numbers |
| `kart/{id}/alerts` | kart → cloud | 1 | threshold violations |
| `kart/{id}/status` | kart → cloud | 1, retained | online/offline (last will), agent + schema version |
| `kart/{id}/cmd` | cloud → kart | 1 | parameter change requests |
| `kart/{id}/cmd/ack` | kart → cloud | 1 | accepted / rejected + reason |

Only `command-api` may publish to `cmd`. The kart authenticates to the broker with an mTLS client certificate. Browser clients (pit wall) connect through the WebSocket listener and may only subscribe to `live` and `status`.

---

## Conventions

- **Schema changes go through `schema/`.** CI runs `buf lint` and `buf breaking`. Never change a field's meaning; add a new one.
- **Version everything together.** Each session records the `kart-agent` version and schema version used, so old logs stay decodable.
- **CI uses path filters.** A change in `schema/` rebuilds and tests everything; other changes only rebuild what they touch.
- **Dashboards, Keycloak realm and DB schema are code.** No changes made only in a UI.
- **No secrets in Git.** Server secrets live in an untracked `.env` on the host (only `.env.example` is committed). WireGuard keys and kart certificates never enter the repo.
- **Safety-relevant code needs a second reviewer.** See `CODEOWNERS` for `command-api/`, `commands.proto` and the command handling in `kart-agent`.

---

## Roadmap

1. **Live MVP:** kart-agent with local logging and time sync, WireGuard, MQTT, ingest, TimescaleDB, pit wall live view, basic Grafana dashboards.
2. **Complete data:** backfill with sequence numbers, lap timing, session and lap-overlay dashboards.
3. **Team access:** Keycloak SSO for Grafana.
4. **Remote parameters:** command-api, param-app, acknowledgments, audit log.
5. **More data:** video (MediaMTX), LoRa fallback link, Parquet archive and analysis tooling.