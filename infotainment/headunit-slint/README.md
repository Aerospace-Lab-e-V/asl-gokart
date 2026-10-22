# headunit-slint

Experiment: can [Slint](https://github.com/slint-ui/slint) replace the Electron headunit? Only the drive page
(`headunit/src/pages/drive-normal.tsx`, incl. header bar) is ported, driven by a Rust port of the Electron mock
kart (`headunit/src/main/adapters/mock.ts`, same lap, physics and blinker timing).

```sh
cargo run --release            # dark, 1024x600
cargo run --release -- --light # start in light theme
cargo test                     # sim sanity check
```

Tap a light icon to toggle it in the mock, tap the clock to switch theme. LAN/cloud/lock in the header are static.

| File | What |
|---|---|
| `ui/drive.slint` | whole page: theme tokens, arc gauges, telltales, temps |
| `src/sim.rs` | mock kart, outputs the signals the Electron adapter would publish |
| `src/main.rs` | 100 ms timer: step sim, push properties; light toggle callback |
| `ui/icons/*.svg` | generated from the React telltales + lucide: `bun scripts/export-icons.tsx` (needs `headunit/node_modules`) |
| `ui/fonts/*.ttf` | Geist, converted from `headunit/src/assets/fonts/geist/*.woff2` (Slint loads ttf/otf only) |

## Comparison (Fedora x86_64, same machine, mock lap running, 60 s after 10 s warmup)

| | Slint (`--release`, femtovg) | Electron (`bun run package`, `HEADUNIT_MOCK=1`) |
|---|---|---|
| Processes | 1 | 7 |
| CPU (one core) | 2.9 % | 22.8 % |
| Memory (PSS, summed) | 54 MiB | 319 MiB |
| Size on disk | 23 MB binary (stripped) | 576 MB package dir |

Caveat: Electron renders the full app (router, stores, toasts), Slint only this page. Cold start not measured.
The Slint binary uses default features (femtovg + software renderer, winit X11 + Wayland, accessibility, system tray);
`default-features = false` with only the needed backend should shrink it.

## Raspberry Pi 4 (not tested)

`--features kms` adds the DRM/KMS backend (no X11/Wayland, kiosk style); run with `SLINT_BACKEND=linuxkms`.
Build needs pkg-config dev packages for libseat, libinput, libudev, gbm, libdrm, xkbcommon, EGL (on this machine
libseat, libinput, gbm and libdrm are missing, so the feature build was not verified). Cross-compile e.g. with
`cargo zigbuild --target aarch64-unknown-linux-gnu`, as done for kart-agent; sysroot libs must then come from the Pi image.

## Gaps found while porting

- **Fonts**: woff2 unsupported, converted to TTF. No OpenType feature control, so no `tabular-nums`: digits are
  proportional and numbers shift width as they change.
- **Path**: `MoveTo`/`ArcTo` child elements with bound coordinates rendered a distorted arc; the same arc as an
  SVG `commands` string with `\{}` interpolation is correct. No `pathLength`/`stroke-dasharray`, so the value arc is
  rebuilt from its end angle.
- **Shadows**: `drop-shadow` exists only on `Rectangle`. Arc glow approximated with a wider translucent stroke;
  telltale glow (dark mode) dropped.
- **Layout**: every element stretches by default; fixed rows need `vertical-stretch: 0`. Elements outside layouts
  default to their preferred size (0 for plain components), so overlays need explicit `width/height: 100%`.
  Stretch shares start from each child's preferred width (unlike CSS `1fr`), so text in a side column moved the
  center column as values changed; fixed by `preferred-width: 0` on the sides and a fixed-width center.
- **Language**: no top-level functions (put them in a `global`). A property named `left` shadows enum values like
  `TextHorizontalAlignment.left`. No wall-clock time, the clock comes from Rust (chrono).
- Throttle at 0 shows no arc; Electron's round-cap dasharray draws a dot.

What worked well: animations (`animate` on bound properties), theme as a `global`, SVG icons with `colorize`
(telltale masks render correctly), property bindings from Rust are plain setters, hot path stays in Rust.

## License (check before any go decision)

Slint is GPLv3, Royalty-free 2.0 or commercial. As far as known the royalty-free license does not cover embedded
devices, so a kart headunit would need GPLv3 compliance or a commercial license. Verify on
<https://slint.dev/terms-and-conditions>.
