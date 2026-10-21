import type { UpdateProgress } from "@/data/updater/updater-types";

/** Headunit app updates. Main resolves URL and asset from the tag. */
export const updater = {
    getReleases: () => window.api.updater.getReleases(),
    install: (tag: string) => window.api.updater.install(tag),
    onProgress: (callback: (progress: UpdateProgress) => void) => window.api.updater.onProgress(callback),
    relaunch: () => window.api.updater.relaunch(),
};
