# headunit


## Install

```
bun install
```

## Run

```
bun run start
```

## Make `Pi4`/`ODROID` image

```
bun run make:pi4
```

```
bun run make:odroid
```

### Output 

- Pi 4 image: `./out/make/deb/arm64/headunit_X.X.X_arm64.deb`
- ODROID image: `./out/make/deb/armv7l/headunit_X.X.X_armhf.deb`

## Dataflow

- Main: `src/main/adapters/sero.ts` decodes Sero events into catalog signals (`analytics/schema/signals.yaml` names) and
  publishes them to `src/main/signal-hub.ts`, which tracks staleness and pushes changes to the
  renderer as one `signals:batch` every 50 ms. Derived values (speed, SoC, temp stats, flow state, hazard) live in
  `src/main/derive.ts`. Commands from the UI go through `src/main/command-bus.ts`.
- Preload: `src/ipc/api.ts` is the whole renderer surface (`window.api`); channels are in `src/ipc/channels.ts`.
- Renderer: `src/services/bridge.ts` (started in `renderer.ts`) writes main's pushes into `src/stores/*`. Views read
  with `useSignal("battery.voltage")` (null = no sample or stale, shown as `--`) and act with `send()` /
  `useCommand()` from `src/services/commands.ts`. State changes only when the ECU echoes it.

Adding a signal: name it in `src/domain/signals.ts` (catalog name), decode it in the Sero adapter, read it with `useSignal`.
