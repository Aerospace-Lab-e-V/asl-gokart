import { counts, type LapCrossing } from "./decode";

/** A lap closed by a counted crossing. */
export interface Lap {
    number: number;
    /** Barrier-precise duration. */
    ms: number;
    /** Device time of the crossing that closed it. */
    endMs: number;
    speedAtEndKmh: number;
}

/** The lap that is running: started by the newest counted crossing. */
export interface RunningLap {
    number: number;
    startMs: number;
}

/**
 * Timing-device crossings of the watched kart's session, outside React state. Seeded from
 * pit-api on open, then appended from `kart/{id}/laps`; readers poll `version` on the tick.
 */
export class LapStore {
    sessionId: string | null = null;
    /** Every crossing of the session (counted or not), sorted by time, unique by id. */
    crossings: LapCrossing[] = [];
    /** Incremented on every change. */
    version = 0;

    /** Clears the store when the kart or its session changes. */
    reset(sessionId: string | null): void {
        this.sessionId = sessionId;
        this.crossings = [];
        this.version++;
    }

    /** Crossings from the database; live ones that already arrived are kept. */
    seed(sessionId: string, crossings: LapCrossing[]): void {
        if (sessionId !== this.sessionId) this.reset(sessionId);
        for (const c of crossings) this.add(c);
        this.version++;
    }

    ingest(c: LapCrossing): void {
        // A crossing the device could not tie to a session still belongs to this kart.
        if (this.sessionId && c.kartSessionId && c.kartSessionId !== this.sessionId) return;
        if (this.add(c)) this.version++;
    }

    laps(): Lap[] {
        const out: Lap[] = [];
        let started: number | null = null;
        for (const c of this.crossings) {
            if (!counts(c.verdict)) continue;
            if (c.lapMs !== null && started !== null) {
                out.push({ number: started, ms: c.lapMs, endMs: c.tMs, speedAtEndKmh: c.speedKmh });
            }
            started = c.lapNumber > 0 ? c.lapNumber : null;
        }
        return out;
    }

    running(): RunningLap | null {
        const last = this.crossings.findLast((c) => counts(c.verdict));
        return last && last.lapNumber > 0 ? { number: last.lapNumber, startMs: last.tMs } : null;
    }

    /** Where the timing device stands, from its newest crossing. */
    barrier(): { lat: number; lon: number } | null {
        const c = this.crossings.at(-1);
        return c && (c.barrierLat !== 0 || c.barrierLon !== 0)
            ? { lat: c.barrierLat, lon: c.barrierLon }
            : null;
    }

    private add(c: LapCrossing): boolean {
        if (this.crossings.some((x) => x.crossingId === c.crossingId)) return false;
        // Outbox resends can arrive late; keep time order.
        const i = this.crossings.findLastIndex((x) => x.tMs <= c.tMs);
        this.crossings.splice(i + 1, 0, c);
        return true;
    }
}

export const laps = new LapStore();

/** Shortest lap, or null before the first one. */
export function bestLap(all: Lap[]): Lap | null {
    return all.reduce<Lap | null>((best, l) => (best === null || l.ms < best.ms ? l : best), null);
}

/** `m:ss.mmm`, or `ss.mmm` under a minute. */
export function formatLapTime(ms: number, decimals = 3): string {
    const totalS = Math.max(0, ms) / 1000;
    const m = Math.floor(totalS / 60);
    const s = (totalS - m * 60).toFixed(decimals);
    return m > 0 ? `${m}:${s.padStart(decimals + 3, "0")}` : s;
}
