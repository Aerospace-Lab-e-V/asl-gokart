import { TILE_RETRY_MS, TILE_SIZE } from "@/data/map-config";
import { levelFor, project, tilesFor, wrapX, type Point, type Tile } from "./tile-math";

/*
 * A follow-cam raster map without a map library: tile <img>s in one div per tile level, moved by a single CSS
 * transform per frame (translate, rotate, scale), so a frame is only compositing. No WebGL, which the Pi 4 lacks.
 * Leaflet has no rotation and lays out on every setView; this view takes no input, so it needs neither.
 */

/** `loading` until the view was first filled, `missing` while visible tiles failed (no offline map has them). */
export type TileStatus = "loading" | "ready" | "missing";

export interface Camera {
    lat: number;
    lon: number;
    /** Fractional; drawn with the nearest tile level, scaled. */
    zoom: number;
    /** Degrees clockwise from north; the map turns the other way so this points up. */
    heading: number;
    /** Panel pixel the camera position sits on. */
    pivot: Point;
    /** Panel pixels around the pivot that must be covered (see coverRadius). */
    radius: number;
}

interface TileEntry {
    img: HTMLImageElement;
    /** `retrying` still counts as failed, so the placeholder does not blink on every retry. */
    state: "loading" | "loaded" | "error" | "retrying";
    lastUsed: number;
}

interface Level {
    z: number;
    url: string;
    el: HTMLDivElement;
    /** Tile the positions are relative to, so they stay small (Chromium stops laying out past ~33M px). */
    anchor: Point;
    tiles: Map<string, TileEntry>;
}

/** Tiles kept (hidden) after they leave the view, so driving back needs no request and works offline. */
const KEEP_TILES = 160;

const key = (t: Tile) => `${t.x}/${t.y}`;

export const tileUrl = (template: string, t: Tile): string =>
    template.replace("{z}", String(t.z)).replace("{x}", String(wrapX(t.x, t.z))).replace("{y}", String(t.y));

export class TileLayer {
    private current: Level | null = null;
    /** The level shown before a zoom level or theme change, kept underneath until the new one fills the view. */
    private previous: Level | null = null;
    private visible: Tile[] = [];
    private lastSet = "";
    private status: TileStatus = "loading";
    private filled = false;
    private camera: Camera | null = null;
    private readonly retryTimer: ReturnType<typeof setInterval>;

    constructor(
        private readonly root: HTMLElement,
        private url: string,
        private readonly onStatus: (status: TileStatus) => void
    ) {
        this.retryTimer = setInterval(this.retry, TILE_RETRY_MS);
    }

    /** For a theme change: the new tiles load over the old ones. */
    setUrl(url: string): void {
        if (url === this.url) return;
        this.url = url;
        if (this.camera) this.render(this.camera, true);
    }

    render(camera: Camera, force = false): void {
        this.camera = camera;
        const z = levelFor(camera.zoom, this.current?.z ?? null);
        if (!this.current || this.current.z !== z || this.current.url !== this.url) this.switchLevel(z, camera);
        const level = this.current!;
        const scale = 2 ** (camera.zoom - z);
        const center = project(camera.lat, camera.lon, z);
        const radius = camera.radius / scale;

        // The tile set only changes when the camera crosses a tile edge or the radius grows by a chunk.
        const set = `${Math.floor(center.x / TILE_SIZE)}/${Math.floor(center.y / TILE_SIZE)}/${Math.ceil(radius / 64)}`;
        if (force || set !== this.lastSet) {
            this.lastSet = set;
            this.update(level, center, radius);
        }

        this.place(level, camera, center, scale);
        if (this.previous) {
            const z0 = this.previous.z;
            this.place(this.previous, camera, project(camera.lat, camera.lon, z0), 2 ** (camera.zoom - z0));
        }
    }

    destroy(): void {
        clearInterval(this.retryTimer);
        this.current?.el.remove();
        this.previous?.el.remove();
        this.current = this.previous = null;
    }

    private switchLevel(z: number, camera: Camera): void {
        // Keep the level that covers the view: the outgoing one if it was filled, else whatever was there before.
        if (this.current && (this.isFilled(this.current) || !this.previous)) {
            this.previous?.el.remove();
            this.previous = this.current;
        } else {
            this.current?.el.remove();
        }
        const center = project(camera.lat, camera.lon, z);
        const el = document.createElement("div");
        el.className = "absolute left-0 top-0 origin-top-left will-change-transform";
        el.dataset.level = String(z);
        this.root.appendChild(el);
        this.current = {
            z,
            url: this.url,
            el,
            anchor: { x: Math.floor(center.x / TILE_SIZE), y: Math.floor(center.y / TILE_SIZE) },
            tiles: new Map(),
        };
        this.lastSet = "";
    }

    private update(level: Level, center: Point, radius: number): void {
        const now = performance.now();
        const wanted = tilesFor(center, level.z, radius);
        const keys = new Set(wanted.map(key));
        for (const t of wanted) {
            const entry = level.tiles.get(key(t)) ?? this.add(level, t);
            entry.lastUsed = now;
            entry.img.hidden = false;
        }
        for (const [k, entry] of level.tiles) if (!keys.has(k)) entry.img.hidden = true;
        if (level.tiles.size > KEEP_TILES + keys.size) {
            const old = [...level.tiles].filter(([k]) => !keys.has(k)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
            for (const [k, entry] of old.slice(0, level.tiles.size - KEEP_TILES - keys.size)) {
                entry.img.remove();
                level.tiles.delete(k);
            }
        }
        this.visible = wanted.filter((t) => t.inView);
        this.updateStatus();
    }

    private add(level: Level, t: Tile): TileEntry {
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.draggable = false;
        img.width = img.height = TILE_SIZE;
        img.className = "absolute max-w-none select-none opacity-0 transition-opacity duration-300";
        img.style.left = `${(t.x - level.anchor.x) * TILE_SIZE}px`;
        img.style.top = `${(t.y - level.anchor.y) * TILE_SIZE}px`;
        const entry: TileEntry = { img, state: "loading", lastUsed: 0 };
        img.onload = () => {
            entry.state = "loaded";
            img.classList.replace("opacity-0", "opacity-100");
            this.updateStatus();
        };
        img.onerror = () => {
            entry.state = "error";
            this.updateStatus();
        };
        img.src = tileUrl(level.url, t);
        level.el.appendChild(img);
        level.tiles.set(key(t), entry);
        return entry;
    }

    private place(level: Level, camera: Camera, center: Point, scale: number): void {
        const x = center.x - level.anchor.x * TILE_SIZE;
        const y = center.y - level.anchor.y * TILE_SIZE;
        level.el.style.transform =
            `translate(${camera.pivot.x}px,${camera.pivot.y}px) rotate(${-camera.heading}deg) scale(${scale}) translate(${-x}px,${-y}px)`;
    }

    private isFilled(level: Level): boolean {
        return this.visible.length > 0 && this.visible.every((t) => level.tiles.get(key(t))?.state === "loaded");
    }

    private updateStatus(): void {
        const level = this.current;
        if (!level) return;
        if (this.isFilled(level)) {
            this.filled = true;
            this.previous?.el.remove();
            this.previous = null;
        }
        const missing = this.visible.filter((t) => level.tiles.get(key(t))?.state !== "loaded");
        // Tiles the old level still shows count as covered, e.g. a pack without the new theme's tiles.
        const failed = !this.previous && missing.some((t) => {
            const state = level.tiles.get(key(t))?.state;
            return state === "error" || state === "retrying";
        });
        const status: TileStatus = failed ? "missing" : this.filled || this.previous ? "ready" : "loading";
        if (status === this.status) return;
        this.status = status;
        this.onStatus(status);
    }

    /** A failed <img> does not request again for the same src, so failed tiles get a fresh element. */
    private retry = (): void => {
        const level = this.current;
        if (!level) return;
        for (const [k, entry] of level.tiles) {
            if (entry.state !== "error") continue;
            const [x, y] = k.split("/").map(Number);
            entry.img.remove();
            level.tiles.delete(k);
            const fresh = this.add(level, { x, y, z: level.z });
            fresh.state = "retrying";
            fresh.lastUsed = entry.lastUsed;
            fresh.img.hidden = entry.img.hidden;
        }
    };
}
