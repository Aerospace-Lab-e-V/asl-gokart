import { describe, expect, test } from "bun:test";
import { BLOCK, blocks, inRange, lonLatToTile, parseAreas, tileCount, tileRange, tileToLonLat } from "./tiles";

describe("tile math", () => {
    test("matches the slippy-map grid", () => {
        // Brandenburg Gate at z16 is tile 35203/21493 (checked with the asinh(tan) form).
        const t = lonLatToTile(13.3777, 52.5163, 16);
        expect([Math.floor(t.x), Math.floor(t.y)]).toEqual([35203, 21493]);
        const [lon, lat] = tileToLonLat(t.x, t.y, 16);
        expect(lon).toBeCloseTo(13.3777, 9);
        expect(lat).toBeCloseTo(52.5163, 9);
    });

    test("a range covers the bbox corners and blocks cover the range", () => {
        const bbox: [number, number, number, number] = [8.8456, 48.5805, 8.8864, 48.6075];
        const r = tileRange(bbox, 19);
        for (const [lon, lat] of [[8.8456, 48.6075], [8.8864, 48.5805]] as const) {
            const t = lonLatToTile(lon, lat, 19);
            expect(inRange(r, Math.floor(t.x), Math.floor(t.y))).toBe(true);
        }
        const covered = new Set<string>();
        for (const b of blocks(r)) for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) covered.add(`${b.x + dx}/${b.y + dy}`);
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) expect(covered.has(`${x}/${y}`)).toBe(true);
        expect(tileCount(r)).toBe((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1));
    });
});

describe("areas.yaml", () => {
    test("accepts the documented shape", () => {
        expect(parseAreas([{ id: "home-track", title: "Home", bbox: [8.8, 48.5, 8.9, 48.6] }])).toEqual([
            { id: "home-track", title: "Home", bbox: [8.8, 48.5, 8.9, 48.6] },
        ]);
    });

    test.each([
        [[], /non-empty/],
        [[{ id: "Home", title: "x", bbox: [0, 0, 1, 1] }], /id must be/],
        [[{ id: "a", title: "x", bbox: [0, 0, 1, 1] }, { id: "a", title: "y", bbox: [0, 0, 1, 1] }], /duplicate/],
        [[{ id: "a", title: " ", bbox: [0, 0, 1, 1] }], /title/],
        [[{ id: "a", title: "x", bbox: [0, 0, 1] }], /bbox must be/],
        [[{ id: "a", title: "x", bbox: [1, 0, 0, 1] }], /west < east/],
    ])("rejects %j", (raw, message) => {
        expect(() => parseAreas(raw)).toThrow(message);
    });
});
