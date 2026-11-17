import type { MapPacksState } from "@/data/map-packs";

/** Offline map packs, kept by main (main/map-packs.ts); Settings → Offline maps. */
export const mapPacks = {
    /** Reads the map server's list again. */
    list: () => window.api.mapPacks.list(),
    install: (id: string) => window.api.mapPacks.install(id),
    cancel: () => window.api.mapPacks.cancel(),
    remove: (id: string) => window.api.mapPacks.remove(id),
    onState: (callback: (state: MapPacksState) => void) => window.api.mapPacks.onState(callback),
};
