import type { EcuId } from "@/data/ecu/ecu-types";
import { SIGNAL_NAMES, signalMeta, type Sample, type SignalBatch, type SignalName } from "@/domain/signals";

/*
 * The one place telemetry lives in main. Adapters publish decoded values by catalog name; the IPC
 * layer forwards what changed as one batch every BATCH_MS. A signal goes stale when its ECU is lost
 * or, for periodic signals, when no sample arrived within its timeout.
 */

export const BATCH_MS = 50;
const STALE_CHECK_MS = 250;

type BatchListener = (batch: SignalBatch) => void;

const samples = new Map<SignalName, Sample>();
let pending: SignalBatch = {};
let hasPending = false;
const listeners = new Set<BatchListener>();
let timers: ReturnType<typeof setInterval>[] = [];

function queue(name: SignalName, sample: Sample | null): void {
    pending[name] = sample;
    hasPending = true;
}

/** `null` means the signal has no valid value right now (e.g. every temperature sensor invalid). */
export function publish(name: SignalName, value: number | null, ts = Date.now()): void {
    if (value === null || !Number.isFinite(value)) {
        if (!samples.has(name)) return;
        samples.delete(name);
        queue(name, null);
        return;
    }
    const prev = samples.get(name);
    if (prev && prev.value === value && !prev.stale) {
        // Same value: keep the timestamp fresh for staleness, don't send it again.
        prev.ts = ts;
        return;
    }
    const sample = { value, ts, stale: false };
    samples.set(name, sample);
    queue(name, sample);
}

/** For an adapter that lost its source (e.g. the connection to kart-agent). */
export function markStale(name: SignalName): void {
    const s = samples.get(name);
    if (!s || s.stale) return;
    const stale = { ...s, stale: true };
    samples.set(name, stale);
    queue(name, stale);
}

export const get = (name: SignalName): Sample | undefined => samples.get(name);

/** A received value that is not stale. Use this for every decision that must not act on old data. */
export function getFresh(name: SignalName): number | undefined {
    const s = samples.get(name);
    return s && !s.stale ? s.value : undefined;
}

export function markEcuLost(ecu: EcuId): void {
    for (const name of SIGNAL_NAMES) if (signalMeta(name).ecu === ecu) markStale(name);
}

export function checkTimeouts(now = Date.now()): void {
    for (const [name, s] of samples) {
        const timeout = signalMeta(name).timeoutMs;
        if (timeout !== undefined && now - s.ts > timeout) markStale(name);
    }
}

export function flush(): void {
    if (!hasPending) return;
    const batch = pending;
    pending = {};
    hasPending = false;
    listeners.forEach((l) => l(batch));
}

/** Every known signal, for a renderer that (re)loads. */
export const snapshot = (): SignalBatch => Object.fromEntries(samples);

/** Returns a function that removes the listener. */
export function onBatch(listener: BatchListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function startSignalHub(): void {
    if (timers.length) return;
    timers = [setInterval(flush, BATCH_MS), setInterval(checkTimeouts, STALE_CHECK_MS)];
}

export function stopSignalHub(): void {
    timers.forEach(clearInterval);
    timers = [];
}

/** Forget everything, for tests. */
export function resetSignalHub(): void {
    stopSignalHub();
    samples.clear();
    pending = {};
    hasPending = false;
    listeners.clear();
}
