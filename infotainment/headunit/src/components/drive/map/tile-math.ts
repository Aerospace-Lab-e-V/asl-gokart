import { MAP_ZOOM_FAST, MAP_ZOOM_OUT_KMH, MAP_ZOOM_STILL, TILE_SIZE } from "@/data/map-config";

/** Web Mercator, slippy-map tiling: world pixels at zoom `z`, x east and y south from the top-left corner. */

export interface Point {
    x: number;
    y: number;
}

export interface Tile {
    x: number;
    y: number;
    z: number;
}

const MAX_LAT = 85.0511287798;

export function project(lat: number, lon: number, z: number): Point {
    const size = TILE_SIZE * 2 ** z;
    const sin = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
    return {
        x: ((lon + 180) / 360) * size,
        y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
    };
}

/**
 * Tiles touching a circle of `radiusPx` (pixels at level `z`) around `center` (`inView`), plus a buffer ring
 * one tile wide. A circle, so the set covers the panel at any rotation. Nearest first, so the middle loads first.
 * `x` is not wrapped at the antimeridian, so it places the tile; wrapX gives the one to request.
 */
export function tilesFor(center: Point, z: number, radiusPx: number): (Tile & { inView: boolean })[] {
    const count = 2 ** z;
    const x0 = Math.floor((center.x - radiusPx) / TILE_SIZE) - 1;
    const x1 = Math.floor((center.x + radiusPx) / TILE_SIZE) + 1;
    const y0 = Math.max(0, Math.floor((center.y - radiusPx) / TILE_SIZE) - 1);
    const y1 = Math.min(count - 1, Math.floor((center.y + radiusPx) / TILE_SIZE) + 1);
    const tiles: (Tile & { inView: boolean; d: number })[] = [];
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            // Distance from the center to the nearest point of the tile.
            const dx = Math.max(x * TILE_SIZE - center.x, 0, center.x - (x + 1) * TILE_SIZE);
            const dy = Math.max(y * TILE_SIZE - center.y, 0, center.y - (y + 1) * TILE_SIZE);
            const d = Math.hypot(dx, dy);
            if (d > radiusPx + TILE_SIZE) continue;
            tiles.push({ x, y, z, inView: d <= radiusPx, d });
        }
    }
    return tiles.sort((a, b) => a.d - b.d).map((t) => ({ x: t.x, y: t.y, z: t.z, inView: t.inView }));
}

export const wrapX = (x: number, z: number): number => {
    const count = 2 ** z;
    return ((x % count) + count) % count;
};

/** Close in at a standstill, further out the faster the kart goes. */
export function zoomForSpeed(kmh: number | null): number {
    const f = Math.min(1, Math.max(0, (kmh ?? 0) / MAP_ZOOM_OUT_KMH));
    return MAP_ZOOM_STILL + (MAP_ZOOM_FAST - MAP_ZOOM_STILL) * f;
}

/** Hysteresis past the halfway point, so a zoom hovering at x.5 does not swap tile levels back and forth. */
const LEVEL_BAND = 0.15;

/** Integer tile level to draw `zoom` with; `current` is the level shown now (null for none yet). */
export function levelFor(zoom: number, current: number | null): number {
    if (current !== null && Math.abs(zoom - current) <= 0.5 + LEVEL_BAND) return current;
    return Math.round(zoom);
}

/** `to - from` in degrees along the shorter way round, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
    const d = (((to - from) % 360) + 540) % 360 - 180;
    return d === -180 ? 180 : d;
}

/** Distance from `pivot` to the farthest corner of a `width` x `height` panel: what a rotating view must cover. */
export const coverRadius = (width: number, height: number, pivot: Point): number =>
    Math.hypot(Math.max(pivot.x, width - pivot.x), Math.max(pivot.y, height - pivot.y));
