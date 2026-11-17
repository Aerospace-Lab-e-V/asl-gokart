import { z } from "zod";

/*
 * Offline map packs: one area of monochrome map tiles per theme, rendered by the analytics stack
 * (analytics/maps) and downloaded from Settings → Offline maps. Main keeps them and serves their tiles
 * to the Drive page's map as maptiles://<theme>/<z>/<x>/<y>.
 */

export const MAP_THEMES = ["dark", "light"] as const;
export type MapTheme = (typeof MAP_THEMES)[number];

const PackFileSchema = z.object({
    /** File name next to index.json; nothing else, so a pack can only come from the map server. */
    path: z.string().regex(/^[\w.-]+\.pmtiles$/),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** One entry of the server's index.json (analytics/maps/render/src/render.ts, PackIndexEntry). */
export const PackIndexEntrySchema = z.object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string(),
    /** [west, south, east, north] */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    minzoom: z.number().int(),
    maxzoom: z.number().int(),
    version: z.string(),
    attribution: z.string(),
    files: z.object({ dark: PackFileSchema, light: PackFileSchema }),
});
export const PackIndexSchema = z.array(PackIndexEntrySchema);
export type PackIndexEntry = z.infer<typeof PackIndexEntrySchema>;

/** A pack on the headunit; its files are `<id>-<theme>.pmtiles` in the packs folder. */
export interface InstalledPack {
    id: string;
    title: string;
    bbox: [number, number, number, number];
    minzoom: number;
    maxzoom: number;
    version: string;
    attribution: string;
    bytes: number;
    /** Epoch ms. */
    installedAt: number;
}

/** One row of Settings → Offline maps: what the server offers, what is installed, or both. */
export interface MapArea {
    id: string;
    title: string;
    /** Download size from the server, else the installed size. */
    bytes: number;
    installed: { version: string; installedAt: number } | null;
    /** Null when the server is unreachable or no longer lists the area. */
    available: { version: string } | null;
}

export interface MapPacksState {
    /** The map server's base URL, or null when there is none to derive it from (no telemetry uplink set). */
    server: string | null;
    /** Why the server's list could not be read, or null when it was. */
    serverError: string | null;
    areas: MapArea[];
    /** The download in progress. */
    download: { id: string; bytes: number; total: number } | null;
}

export const updateAvailable = (area: MapArea): boolean =>
    area.installed !== null && area.available !== null && area.installed.version !== area.available.version;
