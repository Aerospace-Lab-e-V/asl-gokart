# headunit


## Install

```
bun install
```

## Run

```
bun run start
```

Without a kart: `bun run start:mock` drives a simulated kart through a looping lap and answers light commands.

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

## Releases and pre-releases

A `v*` tag builds both debs and publishes a GitHub release (`.github/workflows/ci-release.yml`). The tag must match
`version` in `package.json`.

Pre-release for testing on the kart (`-alpha.N`, `-beta.N`, `-rc.N`):

1. Set `version` in `package.json` to e.g. `0.5.0-alpha.1` and commit it.
2. `git tag v0.5.0-alpha.1 && git push origin v0.5.0-alpha.1`
3. CI marks the release as a pre-release, so it never becomes "Latest".

Install it on the headunit in Settings > Engineer > App update with "Show pre-releases" on, then "Restart now".
The newest stable release below an installed pre-release is badged "previous stable" for going back.
`autodeploy-on-rpi-2.sh` does the same from a shell (no token needed; `GITHUB_TOKEN` only raises the rate limit).

Pre-release and `bun start` builds show version, branch and build time in the bottom-left corner.

## Pi setup

One-time setup on a new headunit Pi.

### Car network

The car LAN is `10.77.0.0/24` (addresses in [`zc/README.md`](../../zc/README.md#fahrzeugnetz)) and has no router.
Give `eth0` its address without a gateway. With a gateway, the Pi sends all internet traffic and DNS into the car as
soon as the LAN is plugged in, and app updates, firmware downloads and the telemetry uplink fail:

```sh
sudo nmcli connection modify "Wired connection 1" \
    ipv4.method manual ipv4.addresses 10.77.0.100/24 ipv4.gateway "" ipv4.never-default yes
```

`nmcli connection` lists the name if it differs. With the LAN plugged in, `ip route get 1.1.1.1` must show the Wi-Fi
interface (`dev wlan0`), not `eth0`. The Wi-Fi must not use `10.77.0.0/24` itself.

Then choose `eth0` in Settings > Network interface.

### Updater

The updater runs `sudo dpkg -i` and needs passwordless sudo for it, set up by hand on the Pi (`sudo visudo -f /etc/sudoers.d/headunit`):

```
<kart-user> ALL=(root) NOPASSWD: /usr/bin/dpkg -i /tmp/headunit-update/*
```

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
