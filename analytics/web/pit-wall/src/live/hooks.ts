import { useSyncExternalStore } from "react";
import { live, type LiveSnapshot } from "./connection";
import type { KartStatus } from "./decode";

export function useLive(): LiveSnapshot {
    return useSyncExternalStore(live.subscribe, live.getSnapshot);
}

export function useKartStatus(kartId: string): KartStatus | undefined {
    return useLive().karts.get(kartId);
}

// Text readouts (tiles, data age) re-render on a shared 10 Hz tick instead of on
// every MQTT message: fast enough to read, and every readout updates in the same frame.
const TICK_MS = 100;
const tickListeners = new Set<() => void>();
let tickNow = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeTick(listener: () => void): () => void {
    tickListeners.add(listener);
    timer ??= setInterval(() => {
        tickNow = Date.now();
        for (const l of tickListeners) l();
    }, TICK_MS);
    return () => {
        tickListeners.delete(listener);
        if (tickListeners.size === 0 && timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };
}

/**
 * Re-renders the calling component every 100 ms and returns the wall-clock time of
 * the tick. Read the telemetry store directly.
 */
export function useTick(): number {
    return useSyncExternalStore(subscribeTick, () => tickNow);
}
