// A small PMTiles v3 writer for raster packs (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md):
// header, root directory (with leaf directories when the root would not fit the first 16 KiB), JSON
// metadata, tile data in tile-id order. Identical tiles (plain ground, water) are stored once.
// Directories and metadata are gzipped; tiles are stored as they come. Read back by the official
// `pmtiles` reader in the tests and on the headunit.

import { gzipSync } from "node:zlib";
import { zxyToTileId } from "pmtiles";

const HEADER_BYTES = 127;
/** The spec keeps header plus root directory within the first 16 KiB, so a reader needs one request. */
const ROOT_MAX_BYTES = 16_384 - HEADER_BYTES;
const COMPRESSION_NONE = 1;
const COMPRESSION_GZIP = 2;
export const TILE_TYPE_WEBP = 4;

interface Entry {
    tileId: number;
    offset: number;
    length: number;
    /** Consecutive tile ids with the same data; 0 marks a pointer to a leaf directory. */
    runLength: number;
}

export interface PackMeta {
    tileType: number;
    minZoom: number;
    maxZoom: number;
    /** [west, south, east, north] */
    bounds: [number, number, number, number];
    metadata: Record<string, unknown>;
}

function varints(values: number[]): number[] {
    const out: number[] = [];
    for (let v of values) {
        // Tile ids pass 2^32 at z16+, so no bitwise operators here.
        while (v >= 0x80) {
            out.push((v % 0x80) | 0x80);
            v = Math.floor(v / 0x80);
        }
        out.push(v);
    }
    return out;
}

/** Column-wise as the spec lays it out: count, id deltas, run lengths, lengths, offsets (0 = right after the previous). */
function serializeDirectory(entries: Entry[]): Buffer {
    const bytes = [...varints([entries.length])];
    let last = 0;
    bytes.push(...varints(entries.map((e) => { const d = e.tileId - last; last = e.tileId; return d; })));
    bytes.push(...varints(entries.map((e) => e.runLength)));
    bytes.push(...varints(entries.map((e) => e.length)));
    bytes.push(
        ...varints(entries.map((e, i) => {
            const prev = entries[i - 1];
            return prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1;
        }))
    );
    return gzipSync(Buffer.from(bytes));
}

/** Root alone if it fits, else the root points at leaves of `leafSize` entries, growing until the root fits. */
function directories(entries: Entry[]): { root: Buffer; leaves: Buffer } {
    const root = serializeDirectory(entries);
    if (root.length <= ROOT_MAX_BYTES) return { root, leaves: Buffer.alloc(0) };
    for (let leafSize = 4096; ; leafSize = Math.ceil(leafSize * 1.2)) {
        const leaves: Buffer[] = [];
        const pointers: Entry[] = [];
        let offset = 0;
        for (let i = 0; i < entries.length; i += leafSize) {
            const leaf = serializeDirectory(entries.slice(i, i + leafSize));
            pointers.push({ tileId: entries[i]!.tileId, offset, length: leaf.length, runLength: 0 });
            leaves.push(leaf);
            offset += leaf.length;
        }
        const root = serializeDirectory(pointers);
        if (root.length <= ROOT_MAX_BYTES) return { root, leaves: Buffer.concat(leaves) };
    }
}

const e7 = (deg: number) => Math.round(deg * 1e7);

/** Builds the archive from tiles keyed `z/x/y` (y from the top, XYZ like the headunit asks for). */
export function writePmtiles(tiles: Map<string, Uint8Array>, meta: PackMeta): Buffer {
    const sorted = [...tiles].map(([key, data]) => {
        const [z, x, y] = key.split("/").map(Number) as [number, number, number];
        return { tileId: zxyToTileId(z, x, y), data };
    });
    sorted.sort((a, b) => a.tileId - b.tileId);

    const entries: Entry[] = [];
    const chunks: Uint8Array[] = [];
    const stored = new Map<string, { offset: number; length: number }>();
    let dataLength = 0;
    for (const { tileId, data } of sorted) {
        const hash = new Bun.CryptoHasher("sha256").update(data).digest("hex");
        let at = stored.get(hash);
        if (!at) {
            at = { offset: dataLength, length: data.length };
            stored.set(hash, at);
            chunks.push(data);
            dataLength += data.length;
        }
        const last = entries[entries.length - 1];
        if (last && last.offset === at.offset && last.tileId + last.runLength === tileId) last.runLength++;
        else entries.push({ tileId, offset: at.offset, length: at.length, runLength: 1 });
    }

    const { root, leaves } = directories(entries);
    const metadata = gzipSync(Buffer.from(JSON.stringify(meta.metadata)));
    const rootOffset = HEADER_BYTES;
    const metadataOffset = rootOffset + root.length;
    const leavesOffset = metadataOffset + metadata.length;
    const dataOffset = leavesOffset + leaves.length;

    const h = Buffer.alloc(HEADER_BYTES);
    h.write("PMTiles", 0, "ascii");
    h.writeUInt8(3, 7);
    const u64 = [rootOffset, root.length, metadataOffset, metadata.length, leavesOffset, leaves.length, dataOffset, dataLength,
        sorted.length, entries.length, stored.size];
    u64.forEach((v, i) => h.writeBigUInt64LE(BigInt(v), 8 + i * 8));
    h.writeUInt8(1, 96); // clustered: tile data is in tile-id order
    h.writeUInt8(COMPRESSION_GZIP, 97);
    h.writeUInt8(COMPRESSION_NONE, 98);
    h.writeUInt8(meta.tileType, 99);
    h.writeUInt8(meta.minZoom, 100);
    h.writeUInt8(meta.maxZoom, 101);
    const [w, s, e, n] = meta.bounds;
    h.writeInt32LE(e7(w), 102);
    h.writeInt32LE(e7(s), 106);
    h.writeInt32LE(e7(e), 110);
    h.writeInt32LE(e7(n), 114);
    h.writeUInt8(meta.maxZoom, 118);
    h.writeInt32LE(e7((w + e) / 2), 119);
    h.writeInt32LE(e7((s + n) / 2), 123);

    return Buffer.concat([h, root, metadata, leaves, ...chunks]);
}
