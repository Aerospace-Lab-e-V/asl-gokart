import { signals, type SignalDef } from "./catalog";
import type { LiveBatch } from "./decode";

/** Chart.js data point (`parsing: false`): x = kart time in ms, y = value or NaN for a break. */
export interface Point {
    x: number;
    y: number;
}

/** History of one signal, columnar and sorted by time. */
export interface SeriesColumns {
    tMs: number[];
    v: number[];
}

/** Longest selectable chart window. */
export const MAX_WINDOW_MS = 10 * 60_000;

/** How much history each signal keeps: the longest window plus a margin. */
const KEEP_MS = MAX_WINDOW_MS + 30_000;

/** A pause longer than this many sample periods is drawn as a break, never interpolated. */
const GAP_PERIODS = 3;

/**
 * A batch of another session only replaces the one on screen after the current session
 * sent nothing for this long (arrival time). A rebooted kart takes over quickly; a second
 * sender with the same kart id (e.g. kart-sim next to a real kart) cannot make the view
 * reset with every batch.
 */
export const SESSION_TAKEOVER_MS = 5_000;

interface Series {
    def: SignalDef;
    /** Shared by reference with the chart datasets; only ever mutated in place. */
    points: Point[];
    latest: { tMs: number; value: number } | null;
    periodMs: number;
    gapMs: number;
    /** Trim once the array grows past this length (chunked, not on every sample). */
    trimAt: number;
    breakPending: boolean;
}

/**
 * Live samples of the watched kart, outside React state. MQTT messages append here;
 * the frame loop polls `version` and redraws when it changed.
 */
export class TelemetryStore {
    sessionId: string | null = null;
    /** Batches lost on the link in this session (gaps in `seq`). */
    lostBatches = 0;
    /** Batches of another session dropped while this one was live (two senders, one kart id). */
    otherSessionBatches = 0;
    /** Newest kart time of any sample, for the data age readout. */
    newestTMs: number | null = null;
    /** Incremented on every change. */
    version = 0;

    private lastSeq: number | null = null;
    /** Arrival time (ms) of this session's last batch. */
    private lastArrivalMs: number | null = null;
    private lastBatchTMs: number | null = null;
    private readonly series = new Map<number, Series>();

    constructor(private readonly keepMs = KEEP_MS) {
        for (const def of signals) {
            const periodMs = 1000 / def.rateHz;
            this.series.set(def.id, {
                def,
                points: [],
                latest: null,
                periodMs,
                gapMs: periodMs * GAP_PERIODS,
                trimAt: Math.ceil((keepMs / periodMs) * 1.25) + 64,
                breakPending: false,
            });
        }
    }

    points(signalId: number): Point[] {
        return this.series.get(signalId)?.points ?? [];
    }

    latest(signalId: number): { tMs: number; value: number } | null {
        return this.series.get(signalId)?.latest ?? null;
    }

    /** Clears all data; a new `session_id` starts from scratch. */
    reset(sessionId: string | null): void {
        this.sessionId = sessionId;
        this.lostBatches = 0;
        this.otherSessionBatches = 0;
        this.newestTMs = null;
        this.lastSeq = null;
        this.lastArrivalMs = null;
        this.lastBatchTMs = null;
        for (const s of this.series.values()) {
            s.points.length = 0;
            s.latest = null;
            s.breakPending = false;
        }
        this.version++;
    }

    /** `arrivalMs`: when the batch was received (wall clock), for the session takeover. */
    ingest(batch: LiveBatch, arrivalMs = Date.now()): void {
        if (batch.sessionId !== this.sessionId) {
            const silent =
                this.lastArrivalMs === null || arrivalMs - this.lastArrivalMs > SESSION_TAKEOVER_MS;
            if (this.sessionId !== null && !silent) {
                this.otherSessionBatches++;
                this.version++;
                return;
            }
            this.reset(batch.sessionId);
        }
        this.lastArrivalMs = arrivalMs;

        if (this.lastSeq !== null) {
            if (batch.seq <= this.lastSeq) return; // duplicate or reordered
            if (batch.seq > this.lastSeq + 1) {
                this.lostBatches += batch.seq - this.lastSeq - 1;
                // Break every signal that probably had samples in the lost batches.
                const firstTMs = Math.min(...batch.samples.map((s) => s.tMs));
                const lostMs = this.lastBatchTMs === null ? Infinity : firstTMs - this.lastBatchTMs;
                for (const s of this.series.values()) {
                    if (lostMs >= s.periodMs) s.breakPending = true;
                }
            }
        }
        this.lastSeq = batch.seq;

        for (const sample of batch.samples) {
            const s = this.series.get(sample.signalId);
            if (!s) continue; // unknown id from a newer kart-agent
            this.append(s, sample.tMs, sample.value);
            if (this.lastBatchTMs === null || sample.tMs > this.lastBatchTMs) {
                this.lastBatchTMs = sample.tMs;
            }
        }
        this.version++;
    }

    /**
     * Prepends history fetched from pit-api. Only points older than what the series
     * already holds are used, so live data always wins where both overlap.
     */
    seed(sessionId: string, history: ReadonlyMap<number, SeriesColumns>): void {
        if (this.sessionId === null) this.reset(sessionId);
        else if (this.sessionId !== sessionId) return;

        for (const [id, cols] of history) {
            const s = this.series.get(id);
            if (!s) continue;

            const firstX = s.points[0]?.x ?? Infinity;
            const older: Point[] = [];
            let prev: number | null = null;
            for (let i = 0; i < cols.tMs.length; i++) {
                const t = cols.tMs[i]!;
                if (t >= firstX) break;
                if (prev !== null) {
                    if (t <= prev) continue;
                    if (t - prev > s.gapMs) older.push({ x: (prev + t) / 2, y: NaN });
                }
                older.push({ x: t, y: cols.v[i]! });
                prev = t;
            }
            if (prev === null) continue;

            if (s.points.length > 0 && firstX - prev > s.gapMs) {
                older.push({ x: (prev + firstX) / 2, y: NaN });
            }
            s.points.splice(0, 0, ...older);
            if (!s.latest) {
                s.latest = { tMs: prev, value: older.findLast((p) => !isNaN(p.y))!.y };
                if (this.newestTMs === null || prev > this.newestTMs) this.newestTMs = prev;
            }
            this.trim(s);
        }
        this.version++;
    }

    private append(s: Series, tMs: number, value: number): void {
        const last = s.points.at(-1);
        if (last) {
            if (tMs <= last.x) return;
            if (s.breakPending || tMs - last.x > s.gapMs) {
                s.points.push({ x: (last.x + tMs) / 2, y: NaN });
            }
        }
        s.breakPending = false;
        s.points.push({ x: tMs, y: value });
        s.latest = { tMs, value };
        if (this.newestTMs === null || tMs > this.newestTMs) this.newestTMs = tMs;
        if (s.points.length > s.trimAt) this.trim(s);
    }

    private trim(s: Series): void {
        const newest = s.points.at(-1);
        if (!newest) return;
        const cutoff = newest.x - this.keepMs;
        // Binary search for the first point inside the kept range.
        let lo = 0;
        let hi = s.points.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (s.points[mid]!.x < cutoff) lo = mid + 1;
            else hi = mid;
        }
        if (lo > 0) s.points.splice(0, lo);
    }
}

/** The one store for the kart currently on screen. */
export const telemetry = new TelemetryStore();
