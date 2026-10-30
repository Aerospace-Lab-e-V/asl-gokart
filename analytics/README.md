# Kart Telemetry & Analytics

Real-time telemetry and long-term analytics for our electric go-kart. Data from the onboard ECUs is collected on the Raspberry Pi head unit, streamed live to our own infrastructure over LTE/5G, and stored for analysis. The same platform shows live data during a session and historical data across seasons, and lets authorized team members adjust vehicle parameters remotely.

> **Core principle:** the kart's local log is the source of truth. The live stream is a best-effort preview. Anything lost on the link is backfilled from the kart afterwards, so every session ends up complete in the cloud.

---

## Architecture

```
ECUs ──Sero/UDP──► Raspberry Pi: kart-agent (systemd service, ships with the headunit)
                 ├─ subscribe to the zone controllers' Sero events → signals
                 ├─ write everything to local session log (always)
                 ├─ live: batch every ~50 ms → MQTT (QoS 0) ─────────┐
                 ├─ backfill: upload log chunks when the link allows ┤
                 ├─ commands: subscribe, validate, apply, ack        │
                 └─ local API for the headunit: status, config, live │
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
| Onboard agent | Rust (Tokio, rumqttc) on Raspberry Pi, systemd service in the headunit `.deb`; Sero via the C++ sero library (`sero-sys`) |
| Local log | MCAP session segments (zstd); an upload index comes with backfill |
| Time sync | chrony with GPS + PPS; Pi is time source for ECUs |
| Network | WireGuard (kart dials out; no open ports on the kart) |
| Transport | MQTT 5, Protobuf payloads, zstd-compressed batches |
| Broker | Mosquitto (or NanoMQ) |
| Time-series DB | TimescaleDB |
| Live view (pit wall) | React + Vite SPA (Bun, TanStack Router/Query, Tailwind + daisyUI, Chart.js), MQTT over WebSocket straight from the broker; `pit-api` (Rust, axum) serves the recent past to seed the charts |
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
├── docs/adr/        # architecture decisions
├── crates/          # Rust workspace (server crates carry their own Dockerfile)
│   ├── telemetry-schema/  # types generated from schema/
│   ├── ecu-sero/          # Sero wire layouts of the zone controllers (decode + encode)
│   ├── sero-sys/          # bindings for the sero C++ runtime (git submodule) + C shim
│   ├── kart-mqtt/         # MQTT uplink shared by kart-agent and kart-sim
│   ├── kart-agent/        # runs on the Pi (dist/: systemd unit, example config)
│   ├── ingest/            # MQTT → TimescaleDB, idempotent by (session, seq)
│   ├── pit-api/           # read-only HTTP: recent samples for the pit wall charts
│   ├── command-api/       # audited parameter writes
│   ├── lap-timing/        # (planned) GPS geofence → lap_crossings
│   └── kart-sim/          # fake kart; replays recorded sessions
├── web/
│   ├── pit-wall/    # real-time live view (Bun, React, Vite)
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
│   ├── kart/        # WireGuard templates (planned); the agent itself ships with the headunit
│   ├── keycloak/    # realm export
│   └── infra/       # Proxmox VM for the Docker host via OpenTofu (optional)
└── testdata/sessions/      # small recorded sessions (Git LFS)
```

---

## Getting started (local development)

You don't need the kart to work on most of this. `kart-sim` simulates a kart driving laps on a placeholder track and publishes its telemetry through the real MQTT path. Replaying recorded sessions comes later.

**Prerequisites:** Docker (with Compose). For working on the Rust code: Rust (stable) and the sero submodule (`git submodule update --init`, or clone with `--recursive`). For the pit wall: [Bun](https://bun.sh) (`buf` comes with its npm dependencies). Later: Node.js with `pnpm` (param-app), Git LFS.

### One-command demo

Runs the whole pipeline in containers: fake kart → Mosquitto → ingest → TimescaleDB → Grafana, plus the pit wall.

```bash
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml --profile sim up --build
```

Open Grafana at http://localhost:3000 (anonymous viewer access; admin login is `admin` / `admin`). If port 3000 is taken (the speedcamera daemon uses it too), start with `GRAFANA_PORT=3001` and open that port instead.
- **Kart Live**: the home dashboard. It refreshes every second and shows the kart moving on the track map. This is a near-live overview only, about 1–2 s behind.
- **Kart Session History**: click a session in the table to open its full time range.

Open the **pit wall** at http://localhost:8080. It jumps to `kart-01` as soon as the sim is online. The raw real-time feed is at `ws://localhost:9001` (MQTT over WebSocket, anonymous in dev). See [Pit wall](#pit-wall-live-view).

Stop the stack with `Ctrl-C`. Add `down -v` to wipe the database and Grafana volumes.

> **Existing database volume?** The read-only roles (`grafana_ro`, `pit_api_ro`) are created only on an empty volume. If your volume predates `pit-api`, either `down -v` once or create the role by hand:
> ```bash
> docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml exec -T timescaledb psql -U kart -d telemetry <<'SQL'
> CREATE ROLE pit_api_ro LOGIN PASSWORD 'pit_api';
> GRANT CONNECT ON DATABASE telemetry TO pit_api_ro;
> GRANT USAGE ON SCHEMA public TO pit_api_ro;
> ALTER DEFAULT PRIVILEGES FOR ROLE kart IN SCHEMA public GRANT SELECT ON TABLES TO pit_api_ro;
> GRANT SELECT ON ALL TABLES IN SCHEMA public TO pit_api_ro;
> SQL
> ```

### The real kart path, without a kart

The `sero` profile runs what the kart runs: `kart-sim --output sero` plays the zone controllers (lights, battery, motor) over Sero, `kart-agent` consumes them and publishes to the broker, and ingest, pit-api and the pit wall work as in the demo.

```bash
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml --profile sero up --build
curl -s 127.0.0.1:7411/v1/status   # the agent's status, as the headunit sees it
```

Natively, both need an interface with IPv4 and multicast; any local Docker bridge that is up works (`ip -br addr`):

```bash
cargo run -p kart-sim -- --output sero --sero-interface <iface>
cargo run -p kart-agent -- --state-dir /tmp/ka/state --runtime-dir /tmp/ka/run --config-dir /tmp/ka/etc \
    --config my-agent.toml      # e.g. [sero] interface = "<iface>", [live] broker_url = "mqtt://localhost:1883"
cargo run -p sero-sys --example sniff -- <iface> 0x0004:0x8001   # raw Sero events
```

Run the headunit (`bun start` in `infotainment/headunit`) next to them to see its Telemetry page.

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

### Developing the pit wall

```bash
# Backend + fake kart + pit-api (port 8081), as in the one-command demo
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml --profile sim up -d --build

cd web/pit-wall
bun install
bun run dev          # http://localhost:5173, proxies /api → :8081 and /mqtt → :9001
```

`bun run gen` (also run by `dev` and `build`) generates `src/gen/` from `schema/proto` and `schema/signals.yaml`, plus the TanStack Router route tree. Generated files are not committed.

| Check | Command |
|---|---|
| Lint / format / types | `bun run lint`, `bun run format:check`, `bun run typecheck` |
| Unit tests (store, decoding, views) | `bun run test` |
| Browser smoke test (needs the sim stack) | `bun run test:e2e` (`PIT_WALL_URL=http://localhost:5173` for the dev server); first time: `bunx playwright install chromium` |

To work on `pit-api` itself, stop its container and run `DATABASE_URL=postgres://pit_api_ro:pit_api@localhost:5432/telemetry cargo run -p pit-api`.

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
The vehicle-data gateway on the Pi. It subscribes to the zone controllers' Sero events and reads the USB GPS, decodes both into catalog signals (stamped when received), and writes **everything** to the local session log first. In parallel it publishes batched live data over MQTT; backfill and parameter commands (checked against its own allowlist and ranges, never trusting the cloud alone) come later. Why it is a separate service rather than part of the Electron app: [ADR-0001](docs/adr/0001-kart-agent-integration.md).

- **Deployment.** The agent ships inside the headunit `.deb` (`/usr/lib/headunit/resources/kart-agent/`) and runs as the systemd service `kart-agent`, independent of the app: it keeps logging when the app is closed, crashed or updating. The package's maintainer scripts link, enable and restart the unit; the in-app updater updates both. CI cross-builds it with `cargo zigbuild` for x86_64 and aarch64 (glibc ≥ 2.31, no C++ runtime) and tests the package lifecycle on the runner (`infotainment/headunit/packaging/test/`).
- **Configuration.** Built-in defaults, then `/etc/kart-agent/agent.toml` (optional, see `crates/kart-agent/dist/agent.toml.example`), then what the headunit's Telemetry page set (`/var/lib/kart-agent/config.override.json`). `live.enabled` switches the uplink only; local logging is always on.
- **GPS.** A u-blox 6 receiver on USB (Navilock NL-602U), found at `/dev/serial/by-id/usb-u-blox*` or the path in `[gps] device`. On every open the agent configures the receiver's RAM (nothing is saved to it): `rate_hz` solutions per second (default 5, the u-blox 6 maximum), the automotive dynamic model, and only RMC, GGA and GSA sentences. Each solution becomes `gps.fix` and `gps.satellites`, plus position, speed, altitude and HDOP when there is a fix (`gps.heading` only above 3 km/h). All samples of one solution share a timestamp: the Pi's receive time, like Sero samples; GPS time is not used for the clock yet. Unplugging is fine: the agent waits and reopens. The systemd unit allows USB serial ports (`DeviceAllow=char-ttyACM`, group `dialout`) and nothing else. On a dev machine: `cargo run -p kart-agent -- --config crates/kart-agent/dev/agent.gps.toml` (see the file for the directories).
- **Local API** (loopback only): `GET /v1/status`, `GET /v1/health`, `GET`/`PUT /v1/config` (JSON merge patch) on `127.0.0.1:7411`. The headunit polls it for the cloud icon in its header bar (red: not recording) and the Telemetry page (Settings → Telemetry, or tap the icon). Anyone can switch the uplink; kart id, broker, car network interface and the GPS (on/off, device) need admin mode, the other settings only the TOML. `tests/fixtures/status.json` is the contract both sides test against. `GET /v1/stream` streams the live samples to the headunit as Server-Sent Events (snapshot on connect, then every sample as it arrives, JSON by catalog name; `curl -N 127.0.0.1:7411/v1/stream`). The headunit takes only the signals no zone controller measures (today `gps.*`) and keeps its own Sero client for the rest, see [ADR-0002](docs/adr/0002-kart-agent-as-headunit-data-source.md); `tests/fixtures/stream.sse` is that contract.
- **Sessions.** One session per power cycle of the Pi (kernel boot id). Agent restarts and updates continue the session and its `seq`.
- **Log.** `/var/lib/kart-agent/log/<session>/seg-<first_seq>-<utc>.mcap`: the same `Batch` bytes as published, plus the schema, session metadata, `signals.yaml` and agent events. Chunks are synced every second; an unfinished `.mcap.active` file after a power cut is readable up to the last sync (`mcap recover`). The oldest segments are deleted above 4 GiB or below 1 GiB free.
- **Clock.** The Pi has no RTC; the status reports whether the clock is synchronised. GPS/PPS time sync comes later.
- On the Pi: `systemctl status kart-agent`, `journalctl -u kart-agent`.

Sero client registry (subscriptions are keyed by client id, so each consumer needs its own):

| Client | Client id | Unicast port |
|---|---|---|
| headunit (`sero-node`) | `0x0002` | 30491 |
| zone controllers | `0x771B` | 30491 |
| kart-agent | `0x0010` | 30492 |
| kart-sim `--output sero` | `0x0F00` + service id | 30500 + service id |

The ECU firmware accepts 4 subscribers per event.

### `ingest`
Subscribes to live and backfill topics and writes to TimescaleDB. Inserts are idempotent on `(session_id, seq)`, so live data and backfill can overlap safely and gaps fill in automatically. Lap crossings from `kart/+/laps` go to `lap_crossings`, idempotent on `crossing_id`.

### `command-api` + `param-app`
The only path for changing vehicle parameters. Every request is authenticated through Keycloak, authorized by role, logged (who, what, old/new value, when), published to the command topic, and only reported as successful after the kart's acknowledgment. Some parameters may only be changed while the kart is stationary.

### `pit-api`
Read-only HTTP for the pit wall, connected as the `pit_api_ro` role. `GET /api/karts/{kart}/sessions/{session}/samples?since_us=…&signals=101,204` returns the session's samples since `since_us` (at most 15 min back, default 5 min) as columns per signal: `{"signals": {"101": {"t_us": […], "v": […]}}}`. `GET /api/karts/{kart}/sessions/{session}/laps` returns every timing-device crossing of the session in time order: `{"crossings": [{"crossing_id", "time" (Unix µs), "lap_number", "lap_us", "verdict", …}]}`. `GET /api/health` for probes.

### Lap timing
Laps come from a trackside timing device: the speedcamera's light barrier ([speedcamera repo](https://github.com/LeoLTM/speedcamera), lap timer plugin). It joins the driver's phone hotspot, subscribes to its kart's `live` and `status` topics, and publishes one `kart.timing.v1.LapCrossing` (`schema/proto/timing.proto`) per barrier crossing on `kart/{id}/laps`:

- **Durations** are measured by the barrier's microcontroller to the µs (`lap_us`); the wall-clock time `t_us` is the device's NTP clock.
- **Verdict:** the device only counts a crossing when the kart's own GPS put it at the barrier around that time (`VERDICT_ACCEPTED`). A crossing while the kart is far away (someone walking through), too slow, a double trigger or with the kart offline is published as rejected and never ends a lap. Without a usable GPS position or synced clocks the crossing counts as `VERDICT_ACCEPTED_UNVERIFIED`.
- **Storage:** every crossing lands in `lap_crossings`, rejected ones included (they explain gaps). The `laps` view holds the completed laps: counted crossings with a `lap_us`.
- **Delivery:** QoS 1 from an outbox on the device, so crossings recorded while the hotspot was down arrive later; ingest ignores resends.

A GPS-geofence lap source (`crates/lap-timing`, planned) would publish the same message for karts without a barrier.

### Pit wall (live view)
The real-time view for the pit area (`web/pit-wall`). The crew watches one kart at a time and judges what they see. The pit wall shows data and link state only; it raises no automatic warnings.

- **Views** (fixed, defined in `src/views/presets.ts`): Overview, Battery, Drivetrain, Thermal, Track (the GPS trail coloured by speed on OpenStreetMap tiles, with the latest position and the light barrier), and Laps (running lap clock, last and best lap, the session's laps and the barrier's crossings with their verdicts). Each view shows value tiles and rolling charts over the last 1, 5 or 10 min (`?window=`).
- **Status line:** broker connection, kart online/offline (retained status, last will), session, data age, lost batches.
- **Data path:** MQTT messages go straight into a store outside React (`src/live/store.ts`). One `requestAnimationFrame` loop redraws the charts when new data arrived; tiles refresh at 10 Hz.
- **History seed:** on open, the charts are filled from `pit-api` with the session's recent past, then live data appends. Where both overlap, live data wins. The lap list is seeded with every crossing of the session the same way.
- **Runtime config:** `/config.json` (`mqttUrl`, `mqttUsername`, `mqttPassword`, `apiBaseUrl`, `tileUrl`, `tileAttribution`); all optional, defaults are the page's own origin (`/mqtt`, `/api`) and the public OpenStreetMap tiles (the browser needs internet for the map background; the trail draws without it).
- **Deployment:** one container (Caddy) serves the SPA and proxies `/api` → `pit-api` and `/mqtt` → Mosquitto, so the browser talks to one origin. TLS and Keycloak go in front of it later.

This is the contract the implementation follows:

- **Connect** to the broker over MQTT on WebSocket. Dev: `ws://localhost:9001`, anonymous. Prod: `wss://` behind the reverse proxy with read-only credentials (TBD together with Keycloak). The pit wall never publishes.
- **Subscribe**
  - `kart/+/status`: retained, so you immediately learn every kart's online state, `session_id` and schema version.
  - `kart/+/live`: QoS 0.
  - `kart/+/laps`: QoS 1, crossings of the lap timing device.
- **Decode** with code generated from `schema/proto/telemetry.proto`, not hand-written:
  - `live` payloads are `kart.telemetry.v1.Batch`;
  - `status` payloads are `Status`;
  - `laps` payloads are `kart.timing.v1.LapCrossing` (`schema/proto/timing.proto`).
- **Signals:** map `Sample.signal_id` through `schema/signals.yaml` (name, unit, min/max, rate). Load the catalog at build time. Ignore unknown IDs, which come from a newer kart-agent.
- **Time:** `Sample.t_us` is Unix time in microseconds from the kart clock (GPS/PPS-disciplined). Plot on that time, not on arrival time.
- **Data age:** show `now − newest t_us`. This is the live latency measurement and the way to verify the 250 ms target. The browser machine's clock must be NTP-synced.
- **Batches** arrive at most every ~50 ms.
  - A batch holds the samples that arrived since the last one. The ECUs send at most 10 Hz (motor every 100 ms, battery and lights only when a value changes), so a signal appears in about every other batch, and intervals without data produce no batch at all.
  - `seq` increments by one per batch. A gap means a batch was lost on the link (QoS 0, expected on LTE). Don't interpolate across it. Backfill only repairs the database, not the live view.
- **Rendering:** the display path has only tens of milliseconds of budget. Buffer incoming samples, draw once per animation frame instead of once per message, and keep a bounded window (for example the last 60 s).
- **Compression:** payloads are uncompressed today. The tech stack plans zstd-compressed batches; if that lands, the browser has to decompress zstd (a WASM decoder in `src/live/decode.ts`).

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
| `kart/{id}/laps` | timing device → cloud | 1 | lap crossings of the light barrier (`timing.proto`) |
| `kart/{id}/cmd` | cloud → kart | 1 | parameter change requests |
| `kart/{id}/cmd/ack` | kart → cloud | 1 | accepted / rejected + reason |

Only `command-api` may publish to `cmd`. The kart authenticates to the broker with an mTLS client certificate. The timing device may only publish to `laps`. Browser clients (pit wall) connect through the WebSocket listener and may only subscribe to `live`, `status` and `laps`.

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

1. **Live MVP:** kart-agent with local logging (done: Sero, MCAP, live MQTT, packaged with the headunit), time sync, WireGuard, MQTT, ingest, TimescaleDB, pit wall live view, basic Grafana dashboards.
2. **Complete data:** backfill with sequence numbers, lap timing, session and lap-overlay dashboards.
3. **Team access:** Keycloak SSO for Grafana.
4. **Remote parameters:** command-api, param-app, acknowledgments, audit log.
5. **More data:** video (MediaMTX), LoRa fallback link, Parquet archive and analysis tooling.