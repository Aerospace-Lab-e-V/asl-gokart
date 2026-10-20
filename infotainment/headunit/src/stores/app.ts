import { create } from "zustand";

interface AppState {
    version: string | null;
    /** Car network interface has an address; null until main reported it. */
    lanConnected: boolean | null;
}

/** Facts about the headunit itself, pushed by main. Only `services/bridge.ts` writes it. */
export const useApp = create<AppState>(() => ({ version: null, lanConnected: null }));
