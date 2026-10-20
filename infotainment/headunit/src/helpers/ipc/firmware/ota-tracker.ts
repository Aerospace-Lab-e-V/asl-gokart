import log from 'electron-log/main';
import { EcuId, OtaPhase, OtaProgress } from '@/data/ecu/ecu-types';
import { onEcuPresenceChange } from './ecu-presence';
import { onFirmwareFetch } from './firmware-server';
import { recordFlash } from './firmware-history';
import { isSessionActive, OtaEvent, OtaSession, reduceOtaSession, startOtaSession } from './ota-session';

/* Feeds the firmware server and Sero presence into one OtaSession per ECU being flashed. */

const TICK_MS = 1000;

const sessions = new Map<EcuId, OtaSession>();
const listeners = new Set<(progress: OtaProgress) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function apply(ecuId: EcuId, event: OtaEvent): void {
    const session = sessions.get(ecuId);
    if (!session) return;
    const next = reduceOtaSession(session, event, Date.now());
    if (next === session) return;

    sessions.set(ecuId, next);
    const { progress } = next;
    if (progress.phase !== session.progress.phase) log.info(`[ota] ${ecuId} ${progress.tag}: ${progress.phase}`, progress.error ?? '');
    if (progress.phase === OtaPhase.Online) recordFlash(ecuId, progress.tag);
    listeners.forEach((l) => l(progress));

    if (![...sessions.values()].some(isSessionActive) && timer) {
        clearInterval(timer);
        timer = null;
    }
}

/** Starts following a flash; call before sending the trigger so an early download is not missed. */
export function trackOta(ecuId: EcuId, tag: string): void {
    const session = startOtaSession(ecuId, tag, Date.now());
    sessions.set(ecuId, session);
    listeners.forEach((l) => l(session.progress));
    timer ??= setInterval(() => sessions.forEach((_, id) => apply(id, { type: 'tick' })), TICK_MS);
}

/** Drops a session whose trigger was never acknowledged. */
export function cancelOta(ecuId: EcuId): void {
    sessions.delete(ecuId);
}

/** The flash in progress for this ECU, or null. */
export function getOtaProgress(ecuId: EcuId): OtaProgress | null {
    const session = sessions.get(ecuId);
    return session && isSessionActive(session) ? session.progress : null;
}

/** Returns a function that removes the listener. */
export function onOtaProgress(listener: (progress: OtaProgress) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function startOtaTracker(): void {
    onFirmwareFetch((e) => {
        const ecuId = e.ecuId as EcuId;
        if (sessions.get(ecuId)?.progress.tag !== e.tag) return;
        if (e.kind === 'start') apply(ecuId, { type: 'fetch-start', totalBytes: e.totalBytes });
        else if (e.kind === 'progress') apply(ecuId, { type: 'fetch-progress', sentBytes: e.sentBytes });
        else apply(ecuId, { type: 'fetch-end', complete: e.complete });
    });
    onEcuPresenceChange((ecuId, presence) => apply(ecuId, { type: presence.online ? 'found' : 'lost' }));
}
