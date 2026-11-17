/** @jest-environment node */
import path from "path";

jest.mock("electron", () => ({ protocol: { registerSchemesAsPrivileged: jest.fn(), handle: jest.fn() } }));

import { tileTouches, TileServer } from "@/main/map-tiles-protocol";
import type { InstalledPack } from "@/data/map-packs";

// Written by analytics/maps/render's PMTiles writer: one tile per zoom (16–19) at the centre of the
// Herrenberg area, each holding "<z>/<x>/<y>" as text instead of an image.
const FIXTURE = path.resolve(__dirname, "fixtures/map-pack.pmtiles");
const CENTER = { 16: [34382, 22618], 17: [68764, 45237], 18: [137528, 90474], 19: [275056, 180949] } as const;

const herrenberg: InstalledPack = {
    id: "herrenberg",
    title: "Herrenberg",
    bbox: [8.8456, 48.5805, 8.8864, 48.6075],
    minzoom: 16,
    maxzoom: 19,
    version: "v1",
    attribution: "",
    bytes: 0,
    installedAt: 0,
};

const serve = (packs: InstalledPack[]) => {
    const file = jest.fn(() => FIXTURE);
    return { server: new TileServer({ installedPacks: () => packs, file }), file };
};

test("serves a pack's tiles as WebP, from the theme's file", async () => {
    const { server, file } = serve([herrenberg]);
    for (const [z, [x, y]] of Object.entries(CENTER)) {
        const res = await server.tile(`maptiles://dark/${z}/${x}/${y}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/webp");
        expect(await res.text()).toBe(`${z}/${x}/${y}`);
    }
    await server.tile(`maptiles://light/19/${CENTER[19].join("/")}`);
    expect(file).toHaveBeenCalledWith("herrenberg", "dark");
    expect(file).toHaveBeenCalledWith("herrenberg", "light");
    server.reset();
});

test("404 outside every pack, its zooms, or for a bad URL", async () => {
    const { server, file } = serve([herrenberg]);
    const [x, y] = CENTER[19];
    // Far away: no pack is even opened.
    expect((await server.tile("maptiles://dark/19/0/0")).status).toBe(404);
    expect((await server.tile(`maptiles://dark/15/${x >> 4}/${y >> 4}`)).status).toBe(404);
    expect(file).not.toHaveBeenCalled();
    // Inside the area, but not in the pack.
    expect((await server.tile(`maptiles://dark/19/${x + 1}/${y}`)).status).toBe(404);
    for (const bad of ["maptiles://sepia/19/1/1", "maptiles://dark/19/1", "maptiles://dark/a/b/c", "maptiles://dark/19/-1/2"]) {
        expect((await server.tile(bad)).status).toBe(404);
    }
    expect((await serve([]).server.tile(`maptiles://dark/19/${x}/${y}`)).status).toBe(404);
    server.reset();
});

test("a tile touches a bbox only where they overlap", () => {
    const [x, y] = CENTER[19];
    expect(tileTouches(herrenberg.bbox, 19, x, y)).toBe(true);
    expect(tileTouches(herrenberg.bbox, 19, 0, 0)).toBe(false);
    // The whole world's tile touches everything.
    expect(tileTouches(herrenberg.bbox, 0, 0, 0)).toBe(true);
});
