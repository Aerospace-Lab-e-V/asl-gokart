// Slippy-map tile math for the render: which tiles an area needs and how they group into the blocks
// rendered in one go. Pure, so `bun test` covers it.

export type Bbox = [west: number, south: number, east: number, north: number];

export interface Area {
    id: string;
    title: string;
    bbox: Bbox;
}

export interface TileRange {
    z: number;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

/** Zooms every pack covers: what the headunit's speed-adaptive zoom (z16.5–18.5) draws with. */
export const MIN_ZOOM = 16;
export const MAX_ZOOM = 19;
/** Tiles per block side; a block is rendered as one 1024 px canvas and cut up. */
export const BLOCK = 4;
export const TILE_SIZE = 256;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validates areas.yaml; throws naming the first bad entry. */
export function parseAreas(raw: unknown): Area[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("areas.yaml: expected a non-empty list");
    const seen = new Set<string>();
    return raw.map((entry, i) => {
        const { id, title, bbox } = (entry ?? {}) as Record<string, unknown>;
        const where = `areas.yaml entry ${i + 1}`;
        if (typeof id !== "string" || !ID.test(id)) throw new Error(`${where}: id must be lowercase letters, digits and dashes`);
        if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
        seen.add(id);
        if (typeof title !== "string" || !title.trim()) throw new Error(`${where}: title is missing`);
        if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v) => typeof v === "number" && Number.isFinite(v))) {
            throw new Error(`${where}: bbox must be [west, south, east, north]`);
        }
        const [w, s, e, n] = bbox as Bbox;
        if (!(w < e && s < n && w >= -180 && e <= 180 && s >= -85 && n <= 85)) throw new Error(`${where}: bbox is not west < east, south < north`);
        return { id, title, bbox: [w, s, e, n] };
    });
}

/** Fractional tile coordinates of a point. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
    const n = 2 ** z;
    const sin = Math.sin((lat * Math.PI) / 180);
    return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n };
}

/** The point at fractional tile coordinates. */
export function tileToLonLat(x: number, y: number, z: number): [lon: number, lat: number] {
    const n = 2 ** z;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    return [(x / n) * 360 - 180, lat];
}

/** Tiles touching the bbox at zoom z, inclusive. */
export function tileRange([w, s, e, n]: Bbox, z: number): TileRange {
    const nw = lonLatToTile(w, n, z);
    const se = lonLatToTile(e, s, z);
    return { z, x0: Math.floor(nw.x), x1: Math.floor(se.x), y0: Math.floor(nw.y), y1: Math.floor(se.y) };
}

export const tileCount = (r: TileRange): number => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);

/** Top-left tiles of the BLOCK x BLOCK blocks that cover a range; the last row/column may stick out. */
export function blocks(r: TileRange): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let y = r.y0; y <= r.y1; y += BLOCK) for (let x = r.x0; x <= r.x1; x += BLOCK) out.push({ x, y });
    return out;
}

export const inRange = (r: TileRange, x: number, y: number): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
