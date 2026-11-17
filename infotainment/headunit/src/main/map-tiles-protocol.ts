import { protocol } from "electron";
import fsp, { type FileHandle } from "fs/promises";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { MAP_THEMES, type InstalledPack, type MapTheme } from "@/data/map-packs";

/*
 * Serves the installed map packs' tiles to the Drive page's map as maptiles://<theme>/<z>/<x>/<y>,
 * from the PMTiles files main keeps (main/map-packs.ts). 404 where no pack covers the tile, which the
 * map shows as "No offline map for this area".
 */

export const MAP_TILES_SCHEME = "maptiles";

/** Before app ready: a standard scheme, so <img> loads it like any URL. */
export function registerMapTilesScheme(): void {
    protocol.registerSchemesAsPrivileged([{ scheme: MAP_TILES_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/** Byte ranges of a local file, for the PMTiles reader. */
class FileSource implements Source {
    private handle: Promise<FileHandle> | null = null;

    constructor(private readonly path: string) {}

    getKey(): string {
        return this.path;
    }

    async getBytes(offset: number, length: number): Promise<RangeResponse> {
        this.handle ??= fsp.open(this.path, "r");
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await (await this.handle).read(buffer, 0, length, offset);
        return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) as ArrayBuffer };
    }

    async close(): Promise<void> {
        const handle = this.handle;
        this.handle = null;
        await (await handle)?.close();
    }
}

/** Whether tile z/x/y overlaps a [west, south, east, north] box. */
export function tileTouches([w, s, e, n]: InstalledPack["bbox"], z: number, x: number, y: number): boolean {
    const count = 2 ** z;
    const lon = (tx: number) => (tx / count) * 360 - 180;
    const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / count))) * 180) / Math.PI;
    return lon(x) < e && lon(x + 1) > w && lat(y + 1) < n && lat(y) > s;
}

const notFound = () => new Response(null, { status: 404 });

/** What the tiles come from: main/map-packs.ts's MapPacks. */
export interface PackFiles {
    installedPacks(): InstalledPack[];
    file(id: string, theme: MapTheme): string;
}

export class TileServer {
    private readers = new Map<string, { source: FileSource; pmtiles: PMTiles }>();

    constructor(private readonly packs: PackFiles) {}

    /** After packs were installed or removed: the next tile opens the files afresh. */
    reset(): void {
        for (const { source } of this.readers.values()) void source.close();
        this.readers.clear();
    }

    async tile(url: string): Promise<Response> {
        const { hostname, pathname } = new URL(url);
        const theme = hostname as MapTheme;
        const [z, x, y] = pathname.slice(1).split("/").map(Number);
        if (!MAP_THEMES.includes(theme) || ![z, x, y].every((v) => Number.isInteger(v) && v! >= 0)) return notFound();

        for (const pack of this.packs.installedPacks()) {
            if (z! < pack.minzoom || z! > pack.maxzoom || !tileTouches(pack.bbox, z!, x!, y!)) continue;
            const tile = await this.reader(this.packs.file(pack.id, theme)).getZxy(z!, x!, y!);
            if (tile) return new Response(new Uint8Array(tile.data), { headers: { "content-type": "image/webp", "cache-control": "no-cache" } });
        }
        return notFound();
    }

    private reader(file: string): PMTiles {
        let reader = this.readers.get(file);
        if (!reader) {
            const source = new FileSource(file);
            reader = { source, pmtiles: new PMTiles(source) };
            this.readers.set(file, reader);
        }
        return reader.pmtiles;
    }
}

export function handleMapTiles(server: TileServer): void {
    protocol.handle(MAP_TILES_SCHEME, (request) => server.tile(request.url));
}
