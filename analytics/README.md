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
Proxmox (Kubernetes)
  MQTT broker ──► ingest ──► TimescaleDB ──► Grafana (history)
       │                          │
       └──► Grafana MQTT data source (live, pushed via WebSocket)
                                  └──► Parquet archive ──► JupyterHub / DuckDB / Polars
  command-api ◄── param-app
  Keycloak (OIDC, brokering SAML) in front of all user-facing services
```

**Latency target:** 250–500 ms from ECU to dashboard. Typical budget: ~50 ms batching, 50–150 ms LTE uplink, ~20 ms broker, ~50 ms Grafana push and render. LTE spikes cause gaps in the live view only; backfill restores them.

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
| Archive | Parquet on S3-compatible object storage (Ceph RGW / SeaweedFS) |
| Dashboards | Grafana OSS (MQTT data source for live, TimescaleDB for history) |
| Session deep dive | Lichtblick / PlotJuggler (open MCAP files directly) |
| Analysis & ML | JupyterHub, Polars, DuckDB, asammdf |
| Auth | Keycloak (OIDC to all services; upstream SAML brokered by Keycloak) |
| Platform | Kubernetes (k3s/Talos) on Proxmox, Helm/Kustomize |
| Later | MediaMTX for video, LoRa fallback link (ChirpStack if LoRaWAN) |

> Grafana OSS supports OIDC but not SAML (SAML is Enterprise-only). Connect Grafana to Keycloak via OIDC; Keycloak handles any SAML identity provider upstream.

---

## Repository layout

```
analytics/
├── schema/          # Source of truth: signal catalog + protobuf definitions
│   ├── signals.yaml # name, ECU, unit, scale, rate, limits
│   ├── proto/       # telemetry.proto, commands.proto
│   └── buf.yaml     # lint + breaking-change checks
├── crates/          # Rust workspace
│   ├── telemetry-schema/  # types generated from schema/
│   ├── kart-agent/        # runs on the Pi
│   ├── ingest/            # MQTT → TimescaleDB, idempotent by (session, seq)
│   ├── command-api/       # audited parameter writes
│   ├── lap-timing/        # GPS geofence → laps table
│   └── kart-sim/          # fake kart; replays recorded sessions
├── python/          # uv workspace
│   ├── kartlib/     # session loading, Parquet/MDF4 export, lap helpers
│   ├── jobs/        # nightly archive + aggregates
│   └── notebooks/   # exploratory analysis (outputs stripped)
├── web/
│   └── param-app/   # TypeScript parameter UI
├── db/migrations/   # TimescaleDB schema, hypertables, continuous aggregates
├── grafana/
│   ├── dashboards/  # dashboard JSON (provisioned, read-only in prod)
│   └── provisioning/
├── deploy/
│   ├── k8s/         # Helm charts / Kustomize overlays (dev, prod)
│   ├── kart/        # systemd units, Ansible for the Pi, WireGuard templates
│   ├── keycloak/    # realm export
│   └── infra/       # Proxmox VMs via OpenTofu (optional)
├── dev/
│   └── docker-compose.yml  # local broker, TimescaleDB, Grafana, Keycloak
└── testdata/sessions/      # small recorded sessions (Git LFS)
```

---

## Getting started (local development)

You don't need the kart to work on most of this. `kart-sim` replays recorded sessions through the real MQTT path.

**Prerequisites:** Rust (stable), Python 3.12+ with `uv`, Node.js with `pnpm`, Docker, `buf`, Git LFS.

```bash
# 1. Fetch recorded test sessions
git lfs pull

# 2. Start the local backend (broker, TimescaleDB, Grafana, Keycloak)
docker compose -f dev/docker-compose.yml up -d

# 3. Apply database migrations
#    (tool TBD: sqlx-cli or dbmate)

# 4. Start the ingest service
cargo run -p ingest

# 5. Replay a recorded session as if the kart were driving
cargo run -p kart-sim -- --replay testdata/sessions/<session>.mcap

# 6. Open Grafana at http://localhost:3000
```

Python tooling:

```bash
cd python
uv sync
uv run jupyter lab
```

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

Built for `aarch64` with `cross` and deployed via Ansible as a systemd service (`deploy/kart/`). It is **not** a Kubernetes node.

### `ingest`
Subscribes to live and backfill topics and writes to TimescaleDB. Inserts are idempotent on `(session_id, seq)`, so live data and backfill can overlap safely and gaps fill in automatically.

### `command-api` + `param-app`
The only path for changing vehicle parameters. Every request is authenticated through Keycloak, authorized by role, logged (who, what, old/new value, when), published to the command topic, and only reported as successful after the kart's acknowledgment. Some parameters may only be changed while the kart is stationary.

### `lap-timing`
Detects start/finish and sector crossings from GPS using track geofences and writes the `laps` table. All lap overlays and comparisons depend on it.

### Grafana
Live panels via the MQTT data source; historical dashboards, track maps (Geomap) and speed-vs-distance overlays (XY chart) via TimescaleDB. Dashboards are code in `grafana/dashboards/`; export changes from the UI and commit them.

### Python (`kartlib`, `jobs`, notebooks)
Nightly export of raw data to Parquet for long-term storage, MDF4/CSV export, and the basis for later ML work (battery degradation, lap time prediction).

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

Only `command-api` may publish to `cmd`. The kart authenticates to the broker with an mTLS client certificate.

---

## Conventions

- **Schema changes go through `schema/`.** CI runs `buf lint` and `buf breaking`. Never change a field's meaning; add a new one.
- **Version everything together.** Each session records the `kart-agent` version and schema version used, so old logs stay decodable.
- **CI uses path filters.** A change in `schema/` rebuilds and tests everything; other changes only rebuild what they touch.
- **Dashboards, Keycloak realm and DB schema are code.** No changes made only in a UI.
- **No secrets in Git.** Cluster secrets via SOPS or Sealed Secrets. WireGuard keys and kart certificates never enter the repo.
- **Notebooks are committed with outputs stripped.** Reusable code moves into `kartlib`.
- **Safety-relevant code needs a second reviewer.** See `CODEOWNERS` for `command-api/`, `commands.proto` and the command handling in `kart-agent`.

---

## Roadmap

1. **Live MVP:** kart-agent with local logging and time sync, WireGuard, MQTT, ingest, TimescaleDB, basic live Grafana dashboard.
2. **Complete data:** backfill with sequence numbers, lap timing, session and lap-overlay dashboards.
3. **Team access:** Keycloak SSO for Grafana and JupyterHub, Parquet archive.
4. **Remote parameters:** command-api, param-app, acknowledgments, audit log.
5. **More data:** video (MediaMTX), LoRa fallback link, ML models.

---

## Open questions

- Where does the proprietary ECU protocol definition live in the monorepo, and should `telemetry-schema` depend on it directly?
- Migration tool: `sqlx-cli` or `dbmate`?
- Helm or Kustomize for `deploy/k8s/`?
- Which parameters may change while driving, and which only when stationary?