# ADR-0001: kart-agent as a systemd service bundled with the headunit

## Status
Accepted

## Date
2026-10-19

## Context
The analytics backend (ingest, pit-api, pit-wall) needs a producer on the kart. The headunit (Electron 31, `infotainment/headunit`)
already talks to the ECUs over Sero through the C++ addon `sero-node`, polled every 10 ms on the Electron main thread.

The first idea was a Rust napi-rs module inside Electron for multithreaded batching and sending. Measured requirements:

- **Load is small.** Sero carries fewer than 50 datagrams/s: motor 19 B at 10 Hz, battery on change, lights on change. The
  planned second provider (rustlet-rt / tinybuf, UDP multicast) stays at ≤ 100 Hz per signal. Throughput is not a reason for
  native code.
- **Logging must outlive the app.** The local log is the source of truth (see README). It has to keep running while the
  headunit is closed, has crashed, or is being updated.
- **The team wants one deployable.** One version, one release, the existing in-app updater (`sudo dpkg -i`), and
  configuration and monitoring from the headunit UI without SSH.
- **A second ECU protocol is coming.** The integration must not be tied to Sero.
- **Latency target:** ≤ 250 ms ECU → pit wall (500 ms hard limit).

## Decision
`kart-agent` is a standalone Rust binary (Tokio) in the analytics workspace, run as a **systemd service** and shipped
**inside the headunit `.deb`**:

- **Packaging.** The binary, unit file and default config live in `/usr/lib/headunit/resources/kart-agent/`. The Debian
  maintainer scripts `systemctl link`, enable and restart the unit. The agent has the same version, tag and updater as the
  headunit, and the package has no dpkg conffiles, so updates never prompt.
- **Build.** `cargo zigbuild` targets glibc 2.31 for x86_64 and aarch64 and runs on the existing x86 GitHub runners.
  There is no Node ABI and no npm package.
- **Sero.** The agent is its own Sero client (client ID `0x0010`, unicast port 30492) and talks to the C++ sero library
  through a thin C shim (`crates/sero-sys`, sero headers as a git submodule pinned to a tag). Wire layouts live once in
  `crates/ecu-sero`, shared by the agent (decode) and `kart-sim --output sero` (encode).
- **Sessions.** One session per Pi boot (`/proc/sys/kernel/random/boot_id`). The session ID and the next `seq` are kept in
  the systemd runtime directory, so restarts and updates continue the session.
- **Local log.** MCAP segments in the systemd state directory hold the same encoded `Batch` bytes that go out over MQTT.
- **Local API.** HTTP on `127.0.0.1:7411` serves status and config. The headunit's Telemetry page uses it. The agent owns
  and persists its config.
- **Phases.** In v1 the headunit keeps its own Sero client and is otherwise unchanged. Later the headunit consumes signals
  and commands from the agent's local API and drops `sero-node`/`tinybuf-node`. The agent then becomes the only ECU
  gateway.

### Sero client registry

| Client | Client ID | Unicast port |
|---|---|---|
| headunit (`sero-node`) | `0x0002` | 30491 |
| zone controllers (the firmware passes its port as client ID) | `0x771B` | 30491 |
| kart-agent | `0x0010` | 30492 |
| kart-sim `--output sero` (providers) | `0x0F00` + service ID | 30500 + service ID |

ECU firmware allows 4 subscribers per event and tracks 4 peers (`zc/*/src/config.hpp`). Today's subscribers are the
headunit, the agent and optionally `zc_logging`.

## Alternatives considered

### Rust napi-rs module inside Electron
- Pros: one process; the headunit gets the data directly.
- Cons:
  - It shares the app's lifetime, so logging stops when the UI is closed, crashes or is updated.
  - A native crash takes down the UI.
  - Every Electron upgrade needs an ABI rebuild.
  - Native modules mean prebuilt binaries per platform on the private registry, plus `.node` loading problems when
    cross-compiling. The earlier `someip-node` napi-rs module was removed for these reasons.
- Rejected: it contradicts "logging must outlive the app" and brings the packaging overhead we want to avoid.

### Electron `utilityProcess` in TypeScript
- Pros: no native code, separate from the main thread, same language as the headunit.
- Cons:
  - Its lifetime is still bound to the Electron app.
  - MQTT, MCAP and session logic would be duplicated in TypeScript, away from the Rust code (`telemetry-schema`, kart-sim)
    already shared with ingest.
- Rejected: it fails the lifecycle requirement.

### Two independent ECU clients permanently (headunit and agent)
- Pros: the headunit stays untouched.
- Cons:
  - Two decoders per protocol (TypeScript and Rust) drift apart.
  - It permanently uses an extra subscriber slot on each ECU.
  - The native modules stay in Electron.
- Rejected as the end state; accepted as the v1 transition.

### Separate `.deb`, Ansible or containers for the agent
- Pros: independent release cycle.
- Cons: version skew between UI and agent; a second update path; someone needs SSH or tooling on the kart.
- Rejected: the team wants one deployable.

### Native Rust port of Sero
- Pros: no C++ in the build; idiomatic async.
- Cons: a second protocol implementation to keep in sync with the C++ library while sero is still at 0.2.x.
- Rejected in favour of FFI. `sero-sys` is written so it can move into the sero repository later.

### `cross` instead of `cargo zigbuild`
- Pros: established; uses real GCC toolchains.
- Cons: needs Docker (Docker-in-Docker on CI); the glibc floor is tied to the image.
- Rejected: zigbuild pins the glibc floor explicitly and runs on a plain runner.

## Consequences
- The agent logs whenever the Pi runs, independent of the UI. During an in-app update there is a gap of about 1–3 s while
  the agent restarts; session and seq continue.
- The headunit release workflow builds Rust: a matrix job produces the agent per architecture before Forge packages the
  `.deb`.
- The agent's shim accepts any Sero sequence-counter jump (`SeqCounterAcceptWindow = 255`). The default window of 15
  locks a receiver out for seconds after a loss burst; the headunit still has that problem until it migrates or sero changes
  upstream.
- The API is loopback-only without authentication in v1. Any local process can change the agent's config. This must be
  hardened (token or peer credentials) before remote commands land.
- Follow-ups:
  - backfill from MCAP segments
  - tinybuf provider
  - headunit migration to the agent's API (signal stream and commands)
  - mTLS and WireGuard
  - GPS/chrony time sync; until then, the clock state is only reported
