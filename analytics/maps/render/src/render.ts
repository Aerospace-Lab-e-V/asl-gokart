// Renders one PMTiles pack per area and theme from areas.yaml, plus index.json for the headunit.
//
//   bun src/render.ts            # areas from ../areas.yaml into ../out
//   MAP_AREAS=… MAP_OUT=… bun src/render.ts
//
// Headless Chromium draws the vector tiles with MapLibre (software WebGL is fine here), a block of
// BLOCK x BLOCK tiles per frame; the page cuts each block into WebP tiles, which go into the
// single-file PMTiles archive the headunit downloads.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { TILE_TYPE_WEBP, writePmtiles } from "./pmtiles-writer";
import { ATTRIBUTION, mapStyle, THEMES, type Theme } from "./style";
import { BLOCK, blocks, inRange, MAX_ZOOM, MIN_ZOOM, parseAreas, TILE_SIZE, tileCount, tileRange, tileToLonLat, type Area } from "./tiles";

const here = import.meta.dir;
const AREAS = process.env.MAP_AREAS ?? path.join(here, "../../areas.yaml");
const OUT = process.env.MAP_OUT ?? path.join(here, "../../out");
/** Flat colours compress well: 0.75 looks the same as 0.9 on the headunit and is 40 % smaller. */
const WEBP_QUALITY = 0.75;
const BLOCK_PX = BLOCK * TILE_SIZE;

export interface PackFile {
    path: string;
    bytes: number;
    sha256: string;
}

/** One entry of index.json; the headunit's schema mirrors this (src/main/map-packs.ts). */
export interface PackIndexEntry {
    id: string;
    title: string;
    bbox: Area["bbox"];
    minzoom: number;
    maxzoom: number;
    /** Render date and a hash of what went in; a different value means "update available". */
    version: string;
    attribution: string;
    files: Record<Theme, PackFile>;
}

declare global {
    interface Window {
        map: { jumpTo(o: object): void; once(e: string, f: () => void): void; getCanvas(): HTMLCanvasElement };
        maplibregl: { Map: new (o: object) => Window["map"] };
    }
}

const PAGE = `<!doctype html><body style="margin:0"><div id="map" style="width:${BLOCK_PX}px;height:${BLOCK_PX}px"></div>
<script type="module">import * as maplibregl from "./maplibre-gl.mjs"; window.maplibregl = maplibregl;</script></body>`;

/**
 * MapLibre ships as ES modules that load their worker relative to themselves, so the page needs an origin:
 * a loopback server for the page and MapLibre's dist/, alive for the render only.
 */
function serveMapLibre(): { url: string; stop: () => void } {
    const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
            const name = new URL(req.url).pathname.slice(1);
            if (name === "") return new Response(PAGE, { headers: { "content-type": "text/html" } });
            if (!/^[\w.-]+\.mjs$/.test(name)) return new Response(null, { status: 404 });
            return new Response(Bun.file(path.join(dist, name)), { headers: { "content-type": "text/javascript" } });
        },
    });
    return { url: `http://127.0.0.1:${server.port}/`, stop: () => server.stop(true) };
}

async function openMap(page: Page, url: string, theme: Theme): Promise<void> {
    await page.goto(url);
    await page.waitForFunction(() => window.maplibregl !== undefined);
    await page.evaluate(
        (style) =>
            new Promise<void>((resolve) => {
                window.map = new window.maplibregl.Map({
                    container: "map",
                    style,
                    interactive: false,
                    attributionControl: false,
                    fadeDuration: 0,
                    pixelRatio: 1,
                    canvasContextAttributes: { preserveDrawingBuffer: true },
                });
                window.map.once("load", () => resolve());
            }),
        mapStyle(theme)
    );
}

/** Draws the block whose top-left tile is x/y and returns its tiles row by row, as base64 WebP. */
async function renderBlock(page: Page, z: number, x: number, y: number): Promise<string[]> {
    const center = tileToLonLat(x + BLOCK / 2, y + BLOCK / 2, z);
    return page.evaluate(
        async ({ center, zoom, block, size, quality }) => {
            window.map.jumpTo({ center, zoom });
            await new Promise<void>((resolve) => window.map.once("idle", resolve));
            const src = window.map.getCanvas();
            const tile = document.createElement("canvas");
            tile.width = tile.height = size;
            const ctx = tile.getContext("2d")!;
            const out: string[] = [];
            for (let dy = 0; dy < block; dy++) {
                for (let dx = 0; dx < block; dx++) {
                    ctx.drawImage(src, dx * size, dy * size, size, size, 0, 0, size, size);
                    out.push(tile.toDataURL("image/webp", quality).split(",")[1]!);
                }
            }
            return out;
        },
        // MapLibre's zoom counts 512 px tiles: one level below the 256 px pack zoom.
        { center, zoom: z - 1, block: BLOCK, size: TILE_SIZE, quality: WEBP_QUALITY }
    );
}

async function renderPack(page: Page, url: string, area: Area, theme: Theme, version: string): Promise<PackFile> {
    const name = `${area.id}-${theme}`;
    const tiles = new Map<string, Uint8Array>();
    await openMap(page, url, theme);

    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
        const range = tileRange(area.bbox, z);
        const todo = blocks(range);
        console.log(`${name} z${z}: ${tileCount(range)} tiles in ${todo.length} blocks`);
        for (const b of todo) {
            const block = await renderBlock(page, z, b.x, b.y);
            block.forEach((data, i) => {
                const x = b.x + (i % BLOCK);
                const y = b.y + Math.floor(i / BLOCK);
                if (inRange(range, x, y)) tiles.set(`${z}/${x}/${y}`, Buffer.from(data, "base64"));
            });
        }
    }

    const archive = writePmtiles(tiles, {
        tileType: TILE_TYPE_WEBP,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        bounds: area.bbox,
        metadata: { name: area.title, attribution: ATTRIBUTION, version },
    });
    const file = `${name}.pmtiles`;
    await Bun.write(path.join(OUT, file), archive);
    return { path: file, bytes: archive.length, sha256: createHash("sha256").update(archive).digest("hex") };
}

/** Same inputs give the same hash; the date tells renders of changed OSM data apart. */
function versionOf(area: Area): string {
    const inputs = JSON.stringify([area, MIN_ZOOM, MAX_ZOOM, WEBP_QUALITY, THEMES.map(mapStyle)]);
    const hash = createHash("sha256").update(inputs).digest("hex").slice(0, 8);
    return `${new Date().toISOString().slice(0, 10)}-${hash}`;
}

async function main(): Promise<void> {
    const areas = parseAreas(Bun.YAML.parse(await Bun.file(AREAS).text()));
    await mkdir(OUT, { recursive: true });
    const server = serveMapLibre();
    // SwiftShader: software WebGL, so the render needs no GPU (CI, docker build).
    const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    const page = await browser.newPage({ viewport: { width: BLOCK_PX, height: BLOCK_PX }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));

    const index: PackIndexEntry[] = [];
    try {
        for (const area of areas) {
            const version = versionOf(area);
            const files = {} as Record<Theme, PackFile>;
            for (const theme of THEMES) files[theme] = await renderPack(page, server.url, area, theme, version);
            index.push({ ...area, minzoom: MIN_ZOOM, maxzoom: MAX_ZOOM, version, attribution: ATTRIBUTION, files });
            console.log(`${area.id}: ${THEMES.map((t) => `${t} ${(files[t].bytes / 1e6).toFixed(1)} MB`).join(", ")}`);
        }
    } finally {
        await browser.close();
        server.stop();
    }
    await Bun.write(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
    console.log(`index.json: ${index.length} area(s)`);
}

if (import.meta.main) await main();
