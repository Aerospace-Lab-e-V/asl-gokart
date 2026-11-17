# Offline map packs

The headunit's Drive page has a **Map** style: a monochrome, label-free, heading-up map beside the speed.
The Pi 4 cannot render vector maps (no WebGL), and third-party basemaps either need a key or forbid in-vehicle use.
So the tiles are our own. They are rendered here from OpenStreetMap data, one **pack** per area. The headunit
downloads a pack on request in **Settings → Offline maps**, and from then on the map works without the server.

```
areas.yaml ──► render (headless Chromium + MapLibre, OpenFreeMap vector tiles)
                 └► out/<id>-dark.pmtiles, out/<id>-light.pmtiles, out/index.json
                        └► map-packs image (Caddy) ◄── pit-wall :8080/maps/ ◄── headunit
```

- **Areas.** Add a venue to [`areas.yaml`](areas.yaml) and rebuild the image. Each pack covers z16–19, which is what the
  headunit's speed-adaptive zoom draws with. It takes about 1 MB per km² per theme (Herrenberg, ~9 km²: 5.3 + 5.8 MB).
- **Look.** The look is defined in [`render/src/style.ts`](render/src/style.ts): a MapLibre style on the OpenMapTiles
  schema, with ground, water, buildings and roads, and raceways a shade brighter. There are no symbol layers, so no labels.
- **Format.** Each pack is a single-file [PMTiles](https://github.com/protomaps/PMTiles) v3 archive of 256 px WebP
  tiles. It is written by [`render/src/pmtiles-writer.ts`](render/src/pmtiles-writer.ts) and read on the headunit with
  the official `pmtiles` reader. `index.json` lists each pack's files with size and sha256, and the headunit checks both
  before it replaces anything.
- **Version.** Each entry carries the render date plus a hash of the inputs. A different version makes the headunit
  offer an **Update**.
- **Licence.** The map data is © OpenStreetMap contributors (ODbL), via OpenMapTiles/OpenFreeMap. The headunit shows
  the attribution on the map.

The rendered packs are build output and stay out of git.

## Build and run

```bash
# with the dev stack: pit-wall proxies /maps/ to the map-packs service
docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml --profile sim up --build
curl localhost:8080/maps/index.json

# the image alone (context: this folder); rendering needs network access to tiles.openfreemap.org
docker build -t map-packs . && docker run --rm -p 8090:8080 map-packs
```

The headunit finds the server from kart-agent's `live.broker_url` (`mqtt://pit:1883` → `http://pit:8080/maps/`).
For development without an agent, start it with `HEADUNIT_MAP_SERVER=http://localhost:8080/maps/ npm run start:mock`.

## Develop the render

```bash
cd render
bun install
bun test                 # tile math, areas.yaml validation, PMTiles writer (round trip through the official reader)
bun run typecheck
bun run render           # ../areas.yaml → ../out; uses Playwright's Chromium (bunx playwright install chromium)
MAP_AREAS=my-areas.yaml MAP_OUT=/tmp/maps bun run render
```
