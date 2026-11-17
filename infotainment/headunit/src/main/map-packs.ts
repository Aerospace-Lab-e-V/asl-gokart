import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { createHash } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable, Transform } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { pipeline } from "stream/promises";
import { CH } from "@/ipc/channels";
import {
    MAP_THEMES,
    PackIndexSchema,
    type InstalledPack,
    type MapArea,
    type MapPacksState,
    type MapTheme,
    type PackIndexEntry,
} from "@/data/map-packs";
import { getConfig } from "@/main/kart-agent-client";

/*
 * Offline map packs on the headunit (Settings → Offline maps). The analytics stack renders them per
 * area (analytics/maps) and serves them next to the pit wall; this downloads one on request, checks it
 * and keeps it in userData/map-packs. Plain http, as the MQTT uplink to the same host is today: only
 * file names from the server's index are fetched, from the server's own origin, and each file's size
 * and sha256 must match before it replaces anything.
 */

/** pit-wall's port, which proxies /maps/ to the map-packs service. */
const MAP_SERVER_PORT = 8080;
const INDEX_TIMEOUT_MS = 10_000;
const PROGRESS_EVERY_MS = 200;

/** The map server on the telemetry broker's host: mqtt://pit:1883 → http://pit:8080/maps/. */
export function mapServerFromBroker(brokerUrl: string): string | null {
    if (!brokerUrl) return null;
    try {
        const { hostname } = new URL(brokerUrl);
        return hostname ? `http://${hostname}:${MAP_SERVER_PORT}/maps/` : null;
    } catch {
        return null;
    }
}

interface Options {
    dir: string;
    /** The server's base URL (ending in /), null for none; throws when it cannot be found out. */
    resolveServer: () => Promise<string | null>;
    /** Every state change: downloads, progress, refreshes. */
    onState?: (state: MapPacksState) => void;
    /** The installed packs changed, so open tile readers are out of date. */
    onInstalledChange?: () => void;
}

export class MapPacks {
    private installed: InstalledPack[];
    private index: PackIndexEntry[] = [];
    private server: string | null = null;
    private serverError: string | null = null;
    private download: MapPacksState["download"] = null;
    private abort: AbortController | null = null;
    private lastProgress = 0;

    constructor(private opts: Options) {
        this.installed = this.loadManifest();
    }

    file(id: string, theme: MapTheme): string {
        return path.join(this.opts.dir, `${id}-${theme}.pmtiles`);
    }

    installedPacks(): InstalledPack[] {
        return this.installed;
    }

    state(): MapPacksState {
        const areas = new Map<string, MapArea>();
        for (const p of this.installed) {
            areas.set(p.id, { id: p.id, title: p.title, bytes: p.bytes, installed: { version: p.version, installedAt: p.installedAt }, available: null });
        }
        for (const e of this.index) {
            const bytes = e.files.dark.bytes + e.files.light.bytes;
            const area = areas.get(e.id);
            areas.set(e.id, { id: e.id, title: e.title, bytes, installed: area?.installed ?? null, available: { version: e.version } });
        }
        return {
            server: this.server,
            serverError: this.serverError,
            areas: [...areas.values()].sort((a, b) => a.title.localeCompare(b.title)),
            download: this.download,
        };
    }

    /** Reads the server's list again; installed packs stay listed when it cannot be reached. */
    async refresh(): Promise<MapPacksState> {
        try {
            this.server = await this.opts.resolveServer();
            this.index = this.server ? await this.fetchIndex(this.server) : [];
            this.serverError = null;
        } catch (e) {
            this.index = [];
            this.serverError = e instanceof Error ? e.message : String(e);
            log.warn("[map-packs] Map server not reachable:", this.serverError);
        }
        return this.emit();
    }

    /** Downloads (or updates) an area; resolves when it is installed. One at a time. */
    async install(id: string): Promise<void> {
        if (this.download) throw new Error("Another map is downloading");
        const entry = this.index.find((e) => e.id === id);
        if (!entry || !this.server) throw new Error("This map is not on the map server");
        const server = this.server;
        const total = entry.files.dark.bytes + entry.files.light.bytes;
        this.download = { id, bytes: 0, total };
        this.abort = new AbortController();
        const { signal } = this.abort;
        const parts = MAP_THEMES.map((theme) => `${this.file(id, theme)}.part`);
        this.emit();

        try {
            await fsp.mkdir(this.opts.dir, { recursive: true });
            for (const [i, theme] of MAP_THEMES.entries()) await this.fetchFile(server, entry.files[theme], parts[i]!, signal);
            // Both files are complete and checked: only now replace the old ones.
            for (const [i, theme] of MAP_THEMES.entries()) await fsp.rename(parts[i]!, this.file(id, theme));
            const pack: InstalledPack = {
                id,
                title: entry.title,
                bbox: entry.bbox,
                minzoom: entry.minzoom,
                maxzoom: entry.maxzoom,
                version: entry.version,
                attribution: entry.attribution,
                bytes: total,
                installedAt: Date.now(),
            };
            this.installed = [...this.installed.filter((p) => p.id !== id), pack];
            await this.saveManifest();
            this.opts.onInstalledChange?.();
            log.info(`[map-packs] Installed ${id} ${entry.version}`);
        } catch (e) {
            await Promise.all(parts.map((p) => fsp.rm(p, { force: true })));
            if (signal.aborted) throw new Error("Download cancelled", { cause: e });
            log.warn(`[map-packs] Download of ${id} failed:`, e);
            throw e;
        } finally {
            this.download = null;
            this.abort = null;
            this.emit();
        }
    }

    cancel(): void {
        this.abort?.abort();
    }

    /** Where state changes go once there is a window to show them. */
    setOnState(onState: (state: MapPacksState) => void): void {
        this.opts.onState = onState;
    }

    async remove(id: string): Promise<void> {
        if (this.download?.id === id) throw new Error("This map is downloading");
        this.installed = this.installed.filter((p) => p.id !== id);
        await this.saveManifest();
        this.opts.onInstalledChange?.();
        await Promise.all(MAP_THEMES.map((theme) => fsp.rm(this.file(id, theme), { force: true })));
        log.info(`[map-packs] Removed ${id}`);
        this.emit();
    }

    private async fetchIndex(server: string): Promise<PackIndexEntry[]> {
        const res = await fetch(new URL("index.json", server), { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`Map server answered HTTP ${res.status}`);
        return PackIndexSchema.parse(await res.json());
    }

    private async fetchFile(server: string, file: PackIndexEntry["files"][MapTheme], dest: string, signal: AbortSignal): Promise<void> {
        const res = await fetch(new URL(file.path, server), { signal });
        if (!res.ok || !res.body) throw new Error(`Map server answered HTTP ${res.status} for ${file.path}`);
        const hash = createHash("sha256");
        let bytes = 0;
        const count = new Transform({
            transform: (chunk: Buffer, _encoding, done) => {
                hash.update(chunk);
                bytes += chunk.length;
                this.progress(chunk.length);
                done(null, chunk);
            },
        });
        await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), count, fs.createWriteStream(dest), { signal });
        if (bytes !== file.bytes || hash.digest("hex") !== file.sha256) throw new Error(`${file.path} arrived damaged, try again`);
    }

    private progress(bytes: number): void {
        if (!this.download) return;
        this.download = { ...this.download, bytes: this.download.bytes + bytes };
        const now = Date.now();
        if (now - this.lastProgress < PROGRESS_EVERY_MS) return;
        this.lastProgress = now;
        this.emit();
    }

    private emit(): MapPacksState {
        const state = this.state();
        this.opts.onState?.(state);
        return state;
    }

    private get manifest(): string {
        return path.join(this.opts.dir, "manifest.json");
    }

    private loadManifest(): InstalledPack[] {
        try {
            const { packs } = JSON.parse(fs.readFileSync(this.manifest, "utf-8")) as { packs: InstalledPack[] };
            // A pack whose files are gone (deleted by hand) is not installed.
            return packs.filter((p) => MAP_THEMES.every((theme) => fs.existsSync(this.file(p.id, theme))));
        } catch {
            return [];
        }
    }

    /** Written next to the old one and renamed over it, so a power cut never leaves half a manifest. */
    private async saveManifest(): Promise<void> {
        await fsp.mkdir(this.opts.dir, { recursive: true });
        await fsp.writeFile(`${this.manifest}.tmp`, JSON.stringify({ packs: this.installed }, null, 2));
        await fsp.rename(`${this.manifest}.tmp`, this.manifest);
    }
}

/** HEADUNIT_MAP_SERVER for development (start:mock has no kart-agent), else kart-agent's broker host. */
async function resolveServer(): Promise<string | null> {
    const override = process.env.HEADUNIT_MAP_SERVER;
    if (override) return override.endsWith("/") ? override : `${override}/`;
    return mapServerFromBroker((await getConfig()).effective.live.broker_url);
}

export function createMapPacks(onInstalledChange: () => void): MapPacks {
    return new MapPacks({ dir: path.join(app.getPath("userData"), "map-packs"), resolveServer, onInstalledChange });
}

export function registerMapPacksListeners(mainWindow: BrowserWindow, packs: MapPacks): void {
    packs.setOnState((state) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.mapPacks.state, state);
    });
    ipcMain.handle(CH.mapPacks.list, () => packs.refresh());
    ipcMain.handle(CH.mapPacks.install, (_event, id: string) => packs.install(id));
    ipcMain.handle(CH.mapPacks.cancel, () => packs.cancel());
    ipcMain.handle(CH.mapPacks.remove, (_event, id: string) => packs.remove(id));
}
