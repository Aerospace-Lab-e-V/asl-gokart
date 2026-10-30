# ADR-0002: kart-agent as the headunit's data source, next to its own Sero client

## Status
Proposed

## Date
2026-10-30

## Context
ADR-0001 put kart-agent on the Pi as a systemd service. Its local API (`127.0.0.1:7411`) was used only for management:
the headunit polls `/v1/status` every second and reads and writes `/v1/config`. ADR-0001 also planned a second phase in
which the agent becomes the only ECU gateway and the headunit drops `sero-node`.

Since then:

- **The agent owns devices on the Pi.** It reads the u-blox GPS (`gps.*`). The headunit cannot show a position, only
  the satellite count from the status.
- **Features are coming that the headunit has to show or control, but that are not zone-controller signals:** a map
  of the kart's position, lap times from the trackside timing device (`kart/{id}/laps`), voice calls to the pit wall,
  driver profiles, and remote commands from the cloud.
- **The headunit's main process is built around adapters.** Since #181, adapters publish decoded values by catalog
  name into the signal hub (`src/main/signal-hub.ts`), which sends batches to the renderer every 50 ms. Adding a
  source does not change stores or views.
- **Load is small.** Fewer than 50 Sero datagrams/s and GPS at up to 5 Hz: at most about 200 samples/s.
- **The agent and the headunit ship in one `.deb` with one version.** They never run different versions, so the local
  API needs no compatibility layer.

Two questions are open: where new functionality goes (Electron native module, kart-agent or headunit), and how the agent
pushes data to the headunit.

## Decision

### Two Sero clients stay
The headunit keeps its own Sero client (`sero-node`, `src/main/adapters/sero.ts`). It keeps reading the zone
controllers' signals, sending the UI's ECU commands, and triggering OTA updates. The agent does **not** become the only
ECU gateway. This reverses the "Phases" bullet of ADR-0001 and its rejection of "two independent ECU clients
permanently".

- Gains: the dashboard and the ECU commands do not depend on the agent's lifecycle. If the agent is down, only the data
  it provides goes stale. The working command and OTA paths are not rewritten.
- Costs, as listed in ADR-0001: two decoders per protocol (Rust `ecu-sero`, TypeScript `adapters/sero.ts` and
  `derive.ts`) can drift apart. Shared test vectors keep them aligned (finding B2 of the headunit dataflow audit).
  Three of the four Sero subscriber slots per event are in use: headunit, agent, and optionally `zc_logging`.
- Revisit if the decoders drift in practice or the slot limit gets in the way.

### Where functionality goes
| Goes into | When | Examples |
|---|---|---|
| kart-agent | Devices attached to the Pi; anything that must run without the UI; data that both the cloud and the headunit need, so it has one owner | GPS (later IMU, NFC reader, Pi health), MCAP log, uplink, lap crossings from the broker, active driver, remote commands |
| headunit `sero-node` client | Zone-controller signals and commands for the UI | Dashboard signals, light and relay toggles, OTA trigger |
| headunit main process | Managing the Pi as a UI device, and the UI's own plumbing | Network, app updater, theme, admin PIN, Bluetooth pairing, signal hub, IPC |
| headunit renderer | Views, and capabilities Chromium provides | Pages, map rendering, WebRTC voice |
| Electron native module | Nothing new; the goal is none | — |

A GPS native module in Electron is ruled out for three reasons. Only one process can read a serial port, the agent
configures the receiver, and the cloud needs the kart's GPS (lap-timing verdicts check the kart's position). The
headunit gets GPS from the agent.

### Channels between the agent and the headunit
- **Push: `GET /v1/stream`, Server-Sent Events.** On connect the agent sends the last value of every signal, then
  every sample as it arrives. Samples go out before the agent's `live.batch_ms` batching, so the stream adds no delay.
  - Each `samples` event is one timestamp (one Sero event or one GPS epoch), as JSON by catalog name:
    `{"t_us":…,"samples":{"gps.lat":48.6,…}}`. `t_us` is the agent's receive time.
  - The stream carries every signal, including zone-controller signals. That costs nothing on loopback and helps
    debugging.
  - Later event types: `lap`, `driver`, `voice`.
  - The stream ends when the API stops, for example on a configuration restart. The headunit reconnects.
- **Request/response: HTTP**, as today: status and configuration. Later this also carries actions the agent owns,
  such as driver login and voice call state.
- **One writer per signal (audit finding A3).** The Sero adapter writes the signals that a zone controller measures:
  those with `ecu` set in the headunit's `src/domain/signals.ts`. The agent adapter (`src/main/adapters/kart-agent.ts`)
  writes the rest.
- **Contract:** `crates/kart-agent/tests/fixtures/stream.sse` is the agent's real output, written by its tests
  (`UPDATE_FIXTURES=1`) and parsed by the headunit's tests. This follows the `status.json` pattern.
- **Formats:** the protobuf `Batch` stays the format for the MCAP log and MQTT. JSON is used only on this loopback
  stream.

### Who owns the upcoming features
- **GPS map.** The data comes from the stream. The Pi 4 has no working WebGL, so MapLibre GL is out. Use an SVG/CSS
  track map.
- **Lap times.** The agent subscribes to `kart/{id}/laps` while online and forwards each crossing as a `lap` event.
- **Voice.** The media runs in the headunit renderer, using Chromium's WebRTC (Opus, echo cancellation, jitter buffer,
  device selection) and WHIP/WHEP to MediaMTX in the analytics stack. The Pi's PipeWire and Bluetooth audio live in the
  desktop session the headunit runs in. The agent is a sandboxed system service with no audio devices. The agent is
  not in the media path: it only relays call state and "pit wants to talk" events between MQTT and the headunit.
- **Driver profiles.** They cover attribution of sessions and laps, per-driver vehicle limits, and UI personalization.
  They do not gate driving.
  - The agent owns the active driver. That is kart state: it survives UI restarts and is stamped into the log and the
    uplink as a timed event, so laps stay attributable when drivers swap within a session.
  - The agent keeps the profile cache and applies the limits to the ECUs. Applying limits depends on firmware that
    publishes ECU-owned settings (rule 6 of the dataflow audit). Speed limit and drive mode are dead UI today.
  - The headunit owns the login UX and the UI preferences, stored in the profile as an opaque `ui` object.
  - Where profiles are created and managed is left to a later ADR.
- **Remote commands and per-driver limits.** These reach the ECUs through the agent's own Sero client. That needs
  method calls in `sero-sys`; its `Command` only has Find, Subscribe, Unsubscribe and Notify today. Local UI commands
  keep going through the headunit's client, so **two senders can command one ECU**. Safety interlocks such as
  "no OTA while moving" therefore belong in ECU firmware, or have to exist in both clients.

## Alternatives considered

### kart-agent as the only ECU gateway (ADR-0001's phase 2)
- Pros: one decoder per protocol, one command path, one subscriber slot freed.
- Cons: the dashboard and ECU commands depend on the agent; the command, derivation and OTA paths would be rewritten.
- Rejected for now, see "Two Sero clients stay".

### GPS and other Pi devices as Electron native modules
- Rejected: one reader per serial port, the cloud needs the data, and the ABI and packaging cost of ADR-0001.

### WebSocket instead of SSE
- Pros: bidirectional.
- Cons: nothing needs to go from the headunit to the agent at stream rates (HTTP covers it). It needs an extra
  dependency on both sides. Browsers apply no CORS to WebSockets, so the agent would also have to check `Origin`.
- Rejected. SSE works with axum and Node's `fetch` out of the box, browsers cannot read it cross-origin, and
  `curl -N` shows it.

### Protobuf on the local stream
- Pros: the same messages as MQTT and MCAP.
- Cons: codegen (`buf`, `protoc-gen-es`, catalog) in the headunit build. Its main benefit, compatibility across
  versions, buys nothing in a single `.deb`.
- Rejected. Revisit if the headunit generates its catalog from `signals.yaml` anyway.

### A local MQTT broker on the Pi, or D-Bus
- Rejected: an extra daemon or bus policy to ship, and fan-out that one consumer does not need.

### Unix socket with peer credentials instead of TCP loopback
- Pros: only the headunit's user could connect.
- Cons: the container dev setup publishes the agent's port. Sero on the car network is unauthenticated anyway, so the
  loopback API is not the weakest link.
- Rejected for now. Revisit with remote commands.

### Voice media in kart-agent, or in a separate service
- In the agent: needs system-wide audio for a sandboxed system service, and puts a WebRTC stack into the process
  that writes the source-of-truth log.
- Separate user-session service: survives UI restarts, but is the most work.
- Rejected in favour of the renderer.

## Consequences
- The headunit gets GPS today, and laps, driver and voice events later, without new native code.
- When the agent is down, only data the agent provides goes stale. The ECU dashboard keeps working.
- A configuration change restarts the agent's API, which drops the stream for 1–3 s.
- The decoder duplication is permanent until this decision is revisited.
- Follow-ups:
  - `lap` events
  - driver state and profiles (its own ADR)
  - voice
  - `sero-sys` method calls for remote commands and per-driver limits
  - shared decoder test vectors between `ecu-sero` and the headunit
