import { create } from "zustand";
import type { Sample, SignalBatch, SignalName } from "@/domain/signals";

/*
 * Telemetry from main, keyed by catalog name (the prefix is the domain: battery., drive., lights., temp.).
 * Only `services/bridge.ts` writes it. A missing key means no sample yet.
 */
export const useSignals = create<SignalBatch>(() => ({}));

export const useSample = (name: SignalName): Sample | null => useSignals((s) => s[name] ?? null);

/** The value to show, or null for "--" (no sample yet, or stale). */
export const useSignal = (name: SignalName): number | null =>
    useSignals((s) => {
        const sample = s[name];
        return sample && !sample.stale ? sample.value : null;
    });

/** Same as useSignal, read once outside React (e.g. inside an animation frame). */
export function readSignal(name: SignalName): number | null {
    const sample = useSignals.getState()[name];
    return sample && !sample.stale ? sample.value : null;
}
