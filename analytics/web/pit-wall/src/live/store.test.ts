import { describe, expect, it } from "vitest";
import type { LiveBatch } from "./decode";
import { TelemetryStore } from "./store";

const SPEED = 204; // drive.speed, 20 Hz → 50 ms period, break after 150 ms
const SOC = 104; // battery.soc, 1 Hz
const T0 = 1_700_000_000_000;

function batch(seq: number, samples: [number, number, number][], sessionId = "s1"): LiveBatch {
    return {
        kartId: "kart-01",
        sessionId,
        seq,
        samples: samples.map(([signalId, tMs, value]) => ({ signalId, tMs, value })),
    };
}

const ys = (s: TelemetryStore, id: number) => s.points(id).map((p) => p.y);

describe("TelemetryStore", () => {
    it("appends samples and tracks latest value and newest time", () => {
        const s = new TelemetryStore();
        s.ingest(batch(1, [[SPEED, T0, 10]]));
        s.ingest(
            batch(2, [
                [SPEED, T0 + 50, 11],
                [SOC, T0 + 40, 80],
            ])
        );
        expect(ys(s, SPEED)).toEqual([10, 11]);
        expect(s.latest(SPEED)).toEqual({ tMs: T0 + 50, value: 11 });
        expect(s.newestTMs).toBe(T0 + 50);
        expect(s.sessionId).toBe("s1");
    });

    it("ignores unknown signal ids and duplicate or reordered batches", () => {
        const s = new TelemetryStore();
        s.ingest(
            batch(5, [
                [SPEED, T0, 1],
                [9999, T0, 1],
            ])
        );
        s.ingest(batch(5, [[SPEED, T0 + 50, 2]]));
        s.ingest(batch(4, [[SPEED, T0 + 100, 3]]));
        expect(ys(s, SPEED)).toEqual([1]);
        expect(s.points(9999)).toEqual([]);
    });

    it("breaks the line on a seq gap and counts lost batches", () => {
        const s = new TelemetryStore();
        s.ingest(batch(1, [[SPEED, T0, 1]]));
        s.ingest(
            batch(2, [
                [SPEED, T0 + 50, 2],
                [SOC, T0 + 50, 80],
            ])
        );
        s.ingest(
            batch(4, [
                [SPEED, T0 + 150, 4],
                [SOC, T0 + 150, 80],
            ])
        ); // seq 3 lost
        expect(s.lostBatches).toBe(1);
        // 20 Hz signal: the lost batch held a sample → break, even though 100 ms < 3 periods.
        expect(ys(s, SPEED)).toEqual([1, 2, NaN, 4]);
        // 1 Hz signal: 100 ms lost is shorter than its period → no break.
        expect(ys(s, SOC)).toEqual([80, 80]);
    });

    it("breaks the line after a pause longer than three sample periods", () => {
        const s = new TelemetryStore();
        s.ingest(batch(1, [[SPEED, T0, 1]]));
        s.ingest(batch(2, [[SPEED, T0 + 100, 2]]));
        s.ingest(batch(3, [[SPEED, T0 + 400, 3]]));
        expect(ys(s, SPEED)).toEqual([1, 2, NaN, 3]);
    });

    it("resets on a new session, keeping array identity for the charts", () => {
        const s = new TelemetryStore();
        const points = s.points(SPEED);
        s.ingest(batch(1, [[SPEED, T0, 1]]));
        s.ingest(batch(9, [[SPEED, T0 + 50, 2]]));
        s.ingest(batch(1, [[SPEED, T0 + 100, 3]], "s2"));
        expect(s.sessionId).toBe("s2");
        expect(s.lostBatches).toBe(0);
        expect(s.points(SPEED)).toBe(points);
        expect(ys(s, SPEED)).toEqual([3]);
    });

    it("trims samples older than the kept range", () => {
        const s = new TelemetryStore(1000);
        for (let i = 0; i < 200; i++) s.ingest(batch(i + 1, [[SPEED, T0 + i * 50, i]]));
        const pts = s.points(SPEED);
        expect(pts.at(-1)!.x - pts[0]!.x).toBeLessThanOrEqual(1000 * 1.3 + 64 * 50);
        expect(pts.length).toBeLessThan(200);
        expect(pts.at(-1)!.y).toBe(199);
    });

    describe("seed", () => {
        it("prepends only history older than the first live sample", () => {
            const s = new TelemetryStore();
            s.ingest(batch(10, [[SPEED, T0 + 100, 3]]));
            const before = s.version;
            s.seed("s1", new Map([[SPEED, { tMs: [T0, T0 + 50, T0 + 100], v: [1, 2, 99] }]]));
            expect(ys(s, SPEED)).toEqual([1, 2, 3]);
            expect(s.version).toBeGreaterThan(before);
        });

        it("inserts breaks for gaps inside history and before live data", () => {
            const s = new TelemetryStore();
            s.ingest(batch(10, [[SPEED, T0 + 2000, 9]]));
            s.seed("s1", new Map([[SPEED, { tMs: [T0, T0 + 50, T0 + 1000], v: [1, 2, 3] }]]));
            expect(ys(s, SPEED)).toEqual([1, 2, NaN, 3, NaN, 9]);
        });

        it("adopts the session when nothing is live yet, ignores other sessions", () => {
            const s = new TelemetryStore();
            s.seed("s1", new Map([[SPEED, { tMs: [T0], v: [5] }]]));
            expect(s.sessionId).toBe("s1");
            expect(s.latest(SPEED)).toEqual({ tMs: T0, value: 5 });
            s.seed("other", new Map([[SPEED, { tMs: [T0 - 100], v: [1] }]]));
            expect(ys(s, SPEED)).toEqual([5]);
        });

        it("does not duplicate points when seeded twice", () => {
            const s = new TelemetryStore();
            const history = new Map([[SPEED, { tMs: [T0, T0 + 50], v: [1, 2] }]]);
            s.seed("s1", history);
            s.seed("s1", history);
            expect(ys(s, SPEED)).toEqual([1, 2]);
        });
    });
});
