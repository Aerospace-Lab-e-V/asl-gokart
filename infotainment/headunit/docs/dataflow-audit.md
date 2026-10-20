# Headunit dataflow audit: smells + target architecture

## Context
Headunit (Electron + React + zustand) mixes transport, state and view concerns: main decodes Sero bytes into
JSON strings, renderer hooks `JSON.parse` into `any`, slices reach into each other, views call `window.sero.*`
directly, and settings are pushed to ECUs as side effects of store changes. Goal: clear decoupling of
data streams (sero, tinybuf, later kart-agent) / state (zustand) / views, so the app stays maintainable and scales
to more signals and a second ECU protocol (ADR 0001).


### Decisions
| Topic | Decision |
|---|---|
| Transport | Transport-agnostic adapters in main (sero, tinybuf, kart-agent swappable) |
| Decoding | Main process decodes; typed signals over IPC, no JSON strings |
| WebSocket path | Legacy, flag for removal |
| Store shape | Split by domain |
| Commands | ECU echo is the only source of truth; no optimistic writes |
| Settings persistence | ECU owns them; headunit reads back |
| Stale data | `null` until first sample, stale flag on timeout / service lost |
| Extra scope | View smells, Electron security, render performance |

---

## 1. Current dataflow

```
zc_* (Sero UDP) -> sero-service.ts (main): magic ids, decode, JSON.stringify per field
                -> webContents.send('sero-<domain>-message', string)       (3 channels)
                -> preload sero-context.ts -> window.sero.on<Domain>Message
                -> hooks/use<Domain>Data.ts (mounted in App.tsx): JSON.parse -> any -> switch(command) -> setX()
                -> one zustand store (5 slices, cross-slice get()) -> pages (17-field useShallow selectors)
zc_throttle (WS) -> ws-server.ts -> 'websocket-throttle-message' -> useThrottleData -> same setters (setRpm, setGear)
kart-agent HTTP  <- renderer fetch() directly (needs webSecurity:false) every 1 s
Commands: views -> window.sero.sendLightsCommand / sendMotorCommand / window.websocket.send(packet)
          store.subscribe -> hardware-command-subscriber.ts -> WS packets (speed limit, pedal mult.)
```
Adding one signal today touches ~6 files: channels, preload context, `ipc.d.ts`, sero-service handler, hook, slice.

## 2. Target architecture

```
MAIN
  adapters/sero.ts  adapters/tinybuf.ts  adapters/kart-agent.ts     (only place that knows a wire format)
        \               |                  /
         SignalHub: decode -> {name, value, ts} keyed by catalog name (analytics/schema/signals.yaml),
                    derived signals (speed, soc, flow, temp stats), staleness (rate_hz timeout + service lost)
         CommandBus: typed Command union -> adapter that owns the ECU -> {ok, error}
         ipc: 'signals:batch' (push, structured clone, batched ~50 ms) | 'command' (invoke) | 'ecu:presence'
PRELOAD
  one typed api object; `ipc.d.ts` = `typeof api` (no hand-maintained duplicate)
RENDERER
  bridge.ts (plain module, started once in renderer.ts, outside React) -> domain stores
  stores/: battery, drive (motor+throttle+gear+speed), lights, ecu, agent, app (version/log/startup), session (admin, ui toggles)
  services/commands.ts: lights.toggleHazard(), motor.setRelay(i,on), drive.setSpeedLimit(kmh) ...
  views: read via selector hooks, act via commands only. No window.*, no wire enums, no packet building.
```

Rules
1. Telemetry stores have no public setters; only `bridge.ts` writes them.
2. Every telemetry value is `{ value, ts } | null`; selectors expose `stale`. Views render `--` for null/stale.
3. Signal names = catalog names (`battery.voltage`), so the kart-agent adapter maps 1:1 and the TS sero decoder
   can be deleted once kart-agent is the gateway. Hand-written TS map for now; codegen from `signals.yaml` when the
   catalog changes often enough to drift.
4. Derived values computed once, in main, next to decoding (not in slice setters, not in hooks).
5. Commands return a result; UI pending state lives in the calling component (`useCommand()`), state changes only
   when the ECU echo arrives.
6. ECU-owned settings (speed limit, pedal multiplier, drive mode, pipe-through) must be published back by the ECU as
   signals. Needs firmware events in `zc/`; until then the setting is shown as "unknown" after restart, not a demo value.

---

## 3. Findings (ranked)

### A. Correctness bugs (fix first)
| # | Where | Smell | Fix |
|---|---|---|---|
| A1 | `lib/utils/flow-state.ts:9-18` | Returns REGEN for current > 0. `signals.yaml` battery.current: "positive = discharge". Comments contradict each other and the code. UI shows "Regenerating" while driving. | Flip sign per catalog; move to main SignalHub with one test. |
| A2 | `stores/batterySlice.ts:32-41` | Temps not filtered for `INVALID_TEMP_C = -127` (`analytics/crates/ecu-sero/src/lib.rs:66`, filtered in `decoder.rs:97`). Min shows -127, avg skewed; empty array -> NaN/Infinity. | Filter invalid in main decoder; null when no valid sensor. |
| A3 | `hooks/useThrottleData.ts:24,27` + `hooks/useMotorData.ts:22,35` | Two transports write `rpm` and `gear`; last writer wins, values flicker. | One owner per signal in SignalHub; WS path removed (see E). |
| A4 | `pages/ecu-controller.tsx:195` | OTA "kart is moving" interlock runs in the view on `useStore.getState().speed`, which defaults to 0 and keeps last value when zc_motor is lost. Safety check depends on a stale UI cache. | Move interlock to main OTA path; require a fresh `drive.speed` sample. |
| A5 | `stores/useStore.ts:12-15`, `stores/sharedSlice.ts:18-35` vs `stores/motorSlice.ts:110-111` | `sharedSlice` silently overrides motor setters by spread order. Reordering slices changes behavior. | Domain stores; clamp logic lives with the setting it clamps. |
| A6 | `stores/motorSlice.ts:62-80`, `stores/batterySlice.ts:25-31`, `stores/lightSlice.ts:41-47` | Demo values as initial state (rpm 1250, throttle 0.75, voltage 67.2, dailyDistance 1234.5, driveMode ludicrous). Real-looking data before any ECU speaks; speed 0 contradicts rpm 1250. | `null` until first sample (decision). |
| A7 | `pages/settings/index.tsx:122` | Drive mode selector only writes the store. Nothing sends it (`ThrottleController.setDriveMode` in `data/zonecontrollers/zonecontrollers.ts:93` is never called). Fake control. | Command + ECU echo, or remove the control. |
| A8 | `components/shared/reset-daily-distance-dialog.tsx:44`, `stores/motorSlice.ts:72` | `dailyDistance` is never received from any ECU; reset writes local 0 and a legacy WS packet. | Source it as a signal (ECU or main-side odometer) or remove. |
| A9 | `pages/car.tsx:55-62` | `useEffect` sends welcome-light color and brightness from store on every mount, overwriting ECU state with headunit defaults each time the page opens. Underglow controls (car.tsx:80-110) are store-only with TODOs. | Send on user intent only; hide unimplemented controls. |
| A10 | `pages/motor.tsx:133-165` | Relay toggle writes `setRelay1On(checked)` after request success while ECU also pushes relay state (`useMotorData.ts:30-33`). Violates ECU-echo rule; relay 1/2 handlers copy-pasted. | `commands.motor.setRelay(i)`; state from echo; one handler. |
| A11 | `helpers/ipc/sero/sero-context.ts:21` | `sendBatteryCommand` sends on a channel with no `ipcMain` handler (`sero-service.ts:406-419`). Silent no-op. | Delete. |
| A12 | `helpers/ipc/sero/sero-service.ts:130-132,142-143` | `SET_TOGGLE_HEADLIGHTS` and `SET_TOGGLE_DRL` both fire method 0x0009. Two names for one thing. | One command. |
| A13 | `components/shared/header-bar.tsx:27-38` | Second subscription to battery voltage, duplicating `useBatteryData.ts:20`. Each instance of HeaderBar (on every page) adds a listener. | Delete; read from store. |
| A14 | `hooks/use*Data.ts` (e.g. `useBatteryData.ts:15`) | `JSON.parse` without try inside IPC listener; payload typed `any` (`data/zonecontrollers/packets.ts:13`). One bad message throws, no validation at the boundary. | Typed structured-clone IPC; validate in main once. |

### B. Architecture: streams vs state vs views
| # | Where | Smell | Fix |
|---|---|---|---|
| B1 | `helpers/ipc/sero/sero-service.ts:49-110,120-164,381-382` | Service/event/method ids as magic numbers; `ECU_DEFINITIONS.seroServiceId` and `ecu-sero/src/lib.rs` ids exist separately. | Ids in one table per adapter. |
| B2 | `sero-service.ts` vs `analytics/crates/ecu-sero/src/{lib,decoder}.rs` | Same wire format decoded twice (TS + Rust). Already drifted: -127 sentinel, brake/reverse light events 0x8004/0x8005 not subscribed in TS, motor min length 16 vs 19, wheel circumference duplicated (`decoder.rs:7-8` cites `motorSlice.ts`). | Short term: TS adapter mirrors ecu-sero + shared test vectors. Long term: kart-agent adapter, delete TS decoder (ADR 0001). |
| B3 | `sero-service.ts:59` | Transport reshaped for UI: DRL duplicated into `[on,on]` "so existing UI works". | UI adapts to signal (`lights.drl`), not the reverse. |
| B4 | `sero-service.ts:252-319` | One motor frame -> 3-5 `webContents.send` with `JSON.stringify`, encoded as fake "GET_*" packets. Commands enum doubles as event type. | `signals:batch` with catalog names. |
| B5 | `sero-service.ts:18,30,53`; `ws-server.ts:18,27` | Adapters hold `BrowserWindow` in module globals and closures; restart logic re-binds windows. | Adapters emit to SignalHub (callback/EventEmitter); only IPC layer knows the window. |
| B6 | `App.tsx:47-52` | Data ingestion is React hooks in `MainAppContent`: pipeline lifecycle tied to render tree; stops while network gate is shown; double-mount risk in StrictMode. | `bridge.ts` started once in `renderer.ts`. |
| B7 | `services/hardware-command-subscriber.ts:4-15` | Store change -> hardware command. State drives actuators; no resend on ECU reconnect; inverts ECU-owns-settings. | Views call commands; store updated from echo. |
| B8 | `stores/batterySlice.ts:49-57`, `stores/motorSlice.ts:84-121` | Domain derivation (speed, SoC, flow state) inside setters with `get()` across slices; flow state recomputed in 4 setters. | Derive in main SignalHub (rule 4). |
| B9 | `hooks/useLightsData.ts:22` | Hazard inferred as `left && right` in a transport hook (both blinking != hazard mode). | ECU publishes hazard state, or derive in main with a named rule. |
| B10 | `stores/systemSlice.ts` | Mixes kart-agent telemetry, mirror of main config (autoStart etc., refetched by pages: `pages/settings/system.tsx:52-63`, `pages/settings/index.tsx:79-108`), UI toggles, auth, and `adminPin` input buffer. | `agent`, `app`, `session` stores; pin buffer is component state. |
| B11 | `hooks/useConnectionData.ts` | Polls `getNetworkInterface` every 5 s while `network-gate.ts` already pushes status. Two sources for one fact. | Subscribe to gate push. |
| B12 | `services/kart-agent/client.ts:9-15`, `hooks/useKartAgentData.ts` | Renderer fetches kart-agent directly; only works because `webSecurity:false`. | kart-agent adapter in main (status + later signals). |
| B13 | `data/` | Mixes domain enums, wire protocol, transport classes (`zonecontrollers.ts:71-111` imports `ws` type while runtime is `faye-websocket`), and UI (`controlling_models/drivetrain.ts:1` imports a component type; `battery.ts` holds colors). Data layer depends on view layer. | `domain/` (types, catalog), `main/adapters/`, `ui/` constants. |
| B14 | Preload contexts + `lib/types/ipc.d.ts` | Hand-written d.ts duplicates context impls; `FirmwareRelease` defined twice (`ipc.d.ts:59`, `data/ecu/ecu-types.ts:32`); one channel constant file per domain and direction. | One api object, type exported from it. |
| B15 | `helpers/ipc/network-gate.ts:99-108` | Registers `ipcMain` handlers at import time; channel strings inline. Every other module uses `register*()`. | Same pattern as the rest. |
| B16 | `helpers/ipc/hardware/hardware-listeners.tsx:6` | Main-process file imports renderer logger (console only, skips electron-log file); `.tsx` for non-JSX. | `electron-log/main`; `.ts`. |

### C. Store (zustand) specifics
| # | Where | Smell | Fix |
|---|---|---|---|
| C1 | `components/admin-mode/code-input.tsx:42`, `code-numberpad.tsx:43` | `useStore()` with no selector: re-render on every telemetry frame. | Selector, or local state. |
| C2 | `pages/drive-normal.tsx:37-56` | 17-field `useShallow` incl. `leftMotorData`/`rightMotorData` objects that are new every frame: whole page re-renders each motor event. | Small components each selecting what they show. |
| C3 | `stores/motorSlice.ts:6`, `stores/useStore.ts:9` | `FlowState` re-exported twice. | Import from domain module. |
| C4 | `stores/lightSlice.ts:11,55` | Typo `underglowBrigthness` leaked into views. | Rename during split. |
| C5 | `stores/motorSlice.ts:69,106` | `rpmBoundaries`, `wheelCircumference` are constants stored as state with setters nobody calls. | Constants. |

### D. Views
| # | Where | Smell | Fix |
|---|---|---|---|
| D1 | `pages/car.tsx`, `pages/drive-normal.tsx`, `pages/motor.tsx`, `pages/settings/*.tsx`, `pages/ecu-controller.tsx`, `pages/settings/app-update.tsx` | ~45 direct `window.*` calls; `pages/settings/drivetrain.tsx:37-45` builds wire packets in a view. | `services/commands.ts` + per-domain service modules. |
| D2 | `pages/drive-normal.tsx:82-84,113-127,163-176` | Each light icon duplicated for on/off, each with the same toggle handler. Toggle semantics cannot express desired state; races with echo. | One `<LightToggle signal command />`; prefer set(desired) commands if firmware allows. |
| D3 | `pages/battery.tsx:17-30`, `pages/motor.tsx`, `pages/drive-normal.tsx`, `components/shared/particle-flow.tsx:198-211` | Theme `MutationObserver` copy-pasted 4x. | One `useIsDark()` hook. |
| D4 | `App.tsx:39` | Admin gating is route-only; privileged IPC (OTA, updater, network restart) callable regardless. | See S2. |

### E. Legacy WebSocket path (flag for removal)
`helpers/ipc/websocket/*`, `helpers/ipc/listeners-register.ts:34-51` (inline send handler, deletes from map while
iterating), `data/zonecontrollers/zonecontrollers.ts:71-111`, `services/throttle-commands.ts`,
`hooks/useThrottleData.ts`, `handlers/default-mapping.ts` (log-only button mappings), commented code
`ws-server.ts:59,80-82`, README WebSocket section.
Blocker: `zc/zc_throttle/src/main.rs` still talks WS, and throttle/raw-throttle display, speed limit and pedal
multiplier commands only exist on this path. Migrate zc_throttle to Sero (or tinybuf) first, then delete.

### S. Electron security
| # | Where | Smell | Fix |
|---|---|---|---|
| S1 | `helpers/ipc/updater/updater-listeners.ts:21-35`, `updater-manager.ts:19,72-73` | Renderer supplies `downloadUrl` (http allowed) and `assetName`; `assetName` goes into `path.join` (traversal) and into `exec(\`sudo dpkg -i "${debPath}"\`)` (shell injection). Renderer compromise = root. | Main resolves URL and asset from `tag` against fetched GitHub releases; `execFile('sudo', ['dpkg','-i', path])`; https only. |
| S2 | `helpers/ipc/firmware/firmware-listeners.ts:31-36` | Same pattern: renderer-supplied firmware URL. | Resolve from tag in main. |
| S3 | `main.ts:26-31` | `nodeIntegration:true`, `webSecurity:false`, `devTools:true` always, no `sandbox`. Preloads rely on `window.require('electron')`. | `nodeIntegration:false`, `sandbox:true`, `webSecurity:true` (after B12), devtools only when setting on. |
| S4 | `helpers/ipc/sero/sero-context.ts:3` | `require('@asl-gokart/sero-node')` in preload: loads native addon into renderer for nothing. | Delete. |
| S5 | `components/admin-mode/code-input.tsx:46` | Admin PIN `"69420"` hard-coded in renderer bundle. | Verify in main against configured hash; main enforces admin for privileged IPC. |

### P. Render performance
| # | Where | Smell | Fix |
|---|---|---|---|
| P1 | `sero-service.ts:52,75,79` | `log.debug` with template strings and `readFloatLE` evaluated per event even when level is info. | Guard or drop hot-path debug logs. |
| P2 | per-event `set()` calls (`useMotorData.ts:21-35`) | 3-5 store writes per motor frame -> 3-5 render passes per subscriber. | One batched write per `signals:batch`. |
| P3 | `components/shared/particle-flow.tsx:192-193` | three.js component re-renders React on every current sample. | Read via `useStore.getState()` / transient subscribe inside `useFrame`. |
| P4 | C1, C2 | Broad subscriptions. | See C. |

---

## 4. Migration order
1. Bugs A1-A14 and S1/S2 (small, independent).
2. Add `signals:batch` + `bridge.ts` + battery store; migrate battery end to end; delete its channel/hook/slice.
3. Same for lights, drive. Add staleness from `ecu-presence.ts` + per-signal timeout.
4. `CommandBus` + `services/commands.ts`; remove `window.sero` from views and `hardware-command-subscriber.ts`.
5. zc_throttle off WS (firmware) -> delete E.
6. kart-agent adapter in main -> drop renderer fetch -> S3 hardening.
7. Later (ADR 0001): kart-agent as gateway, delete TS sero decoder.

## Files referenced (most relevant)
- `src/helpers/ipc/sero/sero-service.ts`, `sero-context.ts`
- `src/stores/*.ts`, `src/hooks/use*Data.ts`, `src/services/hardware-command-subscriber.ts`
- `src/App.tsx`, `src/main.ts`, `src/lib/types/ipc.d.ts`
- `src/pages/{drive-normal,car,motor,battery,ecu-controller}.tsx`, `src/pages/settings/*.tsx`
- `src/helpers/ipc/updater/*`, `src/helpers/ipc/firmware/firmware-listeners.ts`
- Reuse: `analytics/schema/signals.yaml` (names, rate_hz, ranges), `analytics/crates/ecu-sero/src/lib.rs` (ids, layouts),
  `src/helpers/ipc/firmware/ecu-presence.ts` (presence push pattern to copy for staleness),
  `src/services/kart-agent/{client,schema}.ts` (zod boundary pattern to copy for IPC validation)

## Verification
- Before fixing anything: re-grep every cited `file:line` still matches (repo moves fast).
- A1/A2 claims: confirm sign and sentinel against `zc/zc_battery` firmware before anyone fixes them.
- Doc reviewed by team in a PR.
