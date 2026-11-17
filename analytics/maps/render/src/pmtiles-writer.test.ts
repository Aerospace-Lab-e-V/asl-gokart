import { expect, test } from "bun:test";
import { PMTiles, type Source } from "pmtiles";
import { TILE_TYPE_WEBP, writePmtiles } from "./pmtiles-writer";

/** The official reader over an in-memory archive. */
const reader = (archive: Buffer) => {
    const source: Source = {
        getKey: () => "test",
        getBytes: async (offset, length) => ({ data: archive.buffer.slice(archive.byteOffset + offset, archive.byteOffset + offset + length) as ArrayBuffer }),
    };
    return new PMTiles(source);
};

const meta = { tileType: TILE_TYPE_WEBP, minZoom: 16, maxZoom: 19, bounds: [8.8, 48.5, 8.9, 48.6] as [number, number, number, number], metadata: { name: "Test", version: "v1" } };
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (r: { data: ArrayBuffer } | undefined) => (r ? new TextDecoder().decode(r.data) : undefined);

test("the official reader reads back tiles, header and metadata", async () => {
    const tiles = new Map([
        ["16/34382/22618", bytes("a")],
        ["17/68764/45236", bytes("bb")],
        ["19/275056/180949", bytes("ccc")],
    ]);
    const p = reader(writePmtiles(tiles, meta));
    expect(text(await p.getZxy(16, 34382, 22618))).toBe("a");
    expect(text(await p.getZxy(17, 68764, 45236))).toBe("bb");
    expect(text(await p.getZxy(19, 275056, 180949))).toBe("ccc");
    expect(await p.getZxy(19, 275057, 180949)).toBeUndefined();

    const h = await p.getHeader();
    expect(h).toMatchObject({ specVersion: 3, tileType: TILE_TYPE_WEBP, minZoom: 16, maxZoom: 19, numAddressedTiles: 3, clustered: true });
    expect(h.minLon).toBeCloseTo(8.8, 6);
    expect(h.maxLat).toBeCloseTo(48.6, 6);
    expect(await p.getMetadata()).toEqual({ name: "Test", version: "v1" });
});

test("identical tiles are stored once, in runs where the ids are consecutive", async () => {
    const tiles = new Map<string, Uint8Array>();
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) tiles.set(`2/${x}/${y}`, bytes(x === 3 && y === 3 ? "other" : "same"));
    const archive = writePmtiles(tiles, { ...meta, minZoom: 2, maxZoom: 2 });
    const p = reader(archive);
    const h = await p.getHeader();
    expect(h.numAddressedTiles).toBe(16);
    expect(h.numTileContents).toBe(2);
    expect(h.numTileEntries).toBeLessThan(16);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) expect(text(await p.getZxy(2, x, y))).toBe(x === 3 && y === 3 ? "other" : "same");
});

test("a pack too big for one root directory gets leaf directories", async () => {
    // Sparse ids and uneven lengths, so the directory does not gzip into the 16 KiB root.
    let seed = 1;
    const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    const tiles = new Map<string, Uint8Array>();
    while (tiles.size < 20_000) {
        const [x, y] = [275000 + random(4000), 180000 + random(4000)];
        tiles.set(`19/${x}/${y}`, bytes(`${x},${y}`.padEnd(8 + random(200), ".")));
    }
    const p = reader(writePmtiles(tiles, meta));
    const h = await p.getHeader();
    expect(h.leafDirectoryLength).toBeGreaterThan(0);
    expect(h.rootDirectoryLength).toBeLessThanOrEqual(16_384 - 127);
    for (const [key, data] of [...tiles].filter((_, i) => i % 997 === 0)) {
        const [, x, y] = key.split("/").map(Number) as [number, number, number];
        expect(text(await p.getZxy(19, x, y))).toBe(new TextDecoder().decode(data));
    }
});
