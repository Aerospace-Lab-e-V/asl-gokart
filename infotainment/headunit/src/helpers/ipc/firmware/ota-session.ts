import { EcuId, OtaPhase, OtaProgress } from '@/data/ecu/ecu-types';

/*
 * Follows one flash after the ECU acknowledged the OTA trigger. The ECU waits 500 ms, downloads
 * the binary from the headunit's firmware server, writes it and restarts. Sero then reports the
 * ECU lost and found again (reboot detection), or lost once the 30 s offer TTL runs out if the
 * new firmware does not come up. If writing fails the ECU does not restart at all.
 */

/** From the ack until the ECU starts downloading, and the longest pause in the download. */
export const FETCH_TIMEOUT_MS = 20_000;
/** From the end of the download until the ECU is back on Sero (30 s TTL plus a re-find). */
export const BOOT_TIMEOUT_MS = 60_000;

export type OtaEvent =
    | { type: 'fetch-start'; totalBytes: number }
    | { type: 'fetch-progress'; sentBytes: number }
    | { type: 'fetch-end'; complete: boolean }
    | { type: 'lost' }
    | { type: 'found' }
    | { type: 'tick' };

export interface OtaSession {
    progress: OtaProgress;
    /** When the current phase started; while downloading, when the percentage last moved. */
    since: number;
    totalBytes: number;
    /** Sero lost the ECU after the download, i.e. it did restart. */
    restarted: boolean;
}

export const startOtaSession = (ecuId: EcuId, tag: string, now: number): OtaSession => ({
    progress: { ecuId, tag, phase: OtaPhase.WaitingForEcu },
    since: now,
    totalBytes: 0,
    restarted: false,
});

export const isSessionActive = (s: OtaSession) =>
    s.progress.phase !== OtaPhase.Online && s.progress.phase !== OtaPhase.Failed;

const enter = (s: OtaSession, phase: OtaPhase, now: number, extra: Partial<OtaProgress> = {}): OtaSession => ({
    ...s,
    progress: { ecuId: s.progress.ecuId, tag: s.progress.tag, phase, ...extra },
    since: now,
});

const stoppedDownloading = (s: OtaSession) =>
    `The ECU stopped downloading at ${s.progress.percent ?? 0}%. It keeps running the old firmware.`;

const fail = (s: OtaSession, now: number, error: string): OtaSession =>
    enter(s, OtaPhase.Failed, now, { failedPhase: s.progress.phase, error });

/** Returns the same object when the event changes nothing, so callers can skip a push. */
export function reduceOtaSession(s: OtaSession, event: OtaEvent, now: number): OtaSession {
    if (!isSessionActive(s)) return s;
    const { phase } = s.progress;

    switch (event.type) {
        case 'fetch-start':
            if (phase !== OtaPhase.WaitingForEcu) return s;
            return { ...enter(s, OtaPhase.EcuDownloading, now, { percent: 0 }), totalBytes: event.totalBytes };

        case 'fetch-progress': {
            if (phase !== OtaPhase.EcuDownloading || s.totalBytes <= 0) return s;
            const percent = Math.min(100, Math.floor((event.sentBytes / s.totalBytes) * 100));
            if (percent === s.progress.percent) return s;
            return { ...s, progress: { ...s.progress, percent }, since: now };
        }

        case 'fetch-end':
            if (phase !== OtaPhase.EcuDownloading) return s;
            if (!event.complete) return fail(s, now, stoppedDownloading(s));
            return enter(s, OtaPhase.Rebooting, now);

        case 'lost':
            if (phase !== OtaPhase.Rebooting) return s;
            return { ...s, restarted: true };

        case 'found':
            // Sero reports "found" only after the ECU was lost, so after the download this is the restart.
            if (phase !== OtaPhase.Rebooting) return s;
            return enter(s, OtaPhase.Online, now);

        case 'tick':
            if (phase === OtaPhase.WaitingForEcu && now - s.since > FETCH_TIMEOUT_MS) {
                return fail(s, now, 'The ECU accepted the update but never downloaded the firmware. Check that it can reach the headunit.');
            }
            if (phase === OtaPhase.EcuDownloading && now - s.since > FETCH_TIMEOUT_MS) return fail(s, now, stoppedDownloading(s));
            if (phase === OtaPhase.Rebooting && now - s.since > BOOT_TIMEOUT_MS) {
                return fail(
                    s,
                    now,
                    s.restarted
                        ? 'The ECU restarted but did not come back. The new firmware may not boot; flash a known good version over USB.'
                        : 'The ECU downloaded the firmware but did not restart. It probably could not write it and keeps running the old firmware.'
                );
            }
            return s;
    }
}
