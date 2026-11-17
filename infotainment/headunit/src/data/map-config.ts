/*
 * The Map drive style's tiles and camera. The tiles are our own: monochrome, roads only, rendered from
 * OpenStreetMap by the analytics stack (analytics/maps) and downloaded as offline map packs, which main
 * serves on maptiles:// (main/map-tiles-protocol.ts). Raster on purpose: the Pi 4 has no working WebGL for
 * vector maps (ADR-0002). Plain 1x tiles, the 7" panel has a device pixel ratio of 1.
 */

export const MAP_TILE_URL = {
    dark: "maptiles://dark/{z}/{x}/{y}",
    light: "maptiles://light/{z}/{x}/{y}",
};
export const MAP_ATTRIBUTION = "© OpenMapTiles © OpenStreetMap";
export const TILE_SIZE = 256;

/** Zoom at a standstill and from MAP_ZOOM_OUT_KMH on; linear in between. */
export const MAP_ZOOM_STILL = 18.5;
export const MAP_ZOOM_FAST = 16.5;
export const MAP_ZOOM_OUT_KMH = 80;

/** Where the kart arrow sits, as a fraction of the panel height: low, so more of the road ahead shows. */
export const MAP_PIVOT_Y = 0.65;

/** How long the map holds the last position after GPS goes stale, dimmed, before it gives up. */
export const GPS_HOLD_MS = 30_000;
/** Missing tiles are requested again this often, so a pack downloaded meanwhile shows up by itself. */
export const TILE_RETRY_MS = 5000;
