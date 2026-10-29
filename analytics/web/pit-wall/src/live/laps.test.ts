import { describe, expect, it } from "vitest";
import type { LapCrossing, VerdictName } from "./decode";
import { bestLap, formatLapTime, LapStore } from "./laps";

const T0 = 1_700_000_000_000;
let nextId = 0;

function crossing(
    tS: number,
    lapNumber: number,
    lapMs: number | null,
    verdict: VerdictName = "ACCEPTED",
    kartSessionId = "s1"
): LapCrossing {
    return {
        crossingId: `c${nextId++}`,
        deviceId: "speedcamera-01",
        kartSessionId,
        tMs: T0 + tS * 1000,
        lapNumber,
        lapMs,
        speedKmh: 40,
        verdict,
        distanceM: 2,
        barrierLat: 48.1,
        barrierLon: 11.5,
        clockSynced: true,
    };
}

describe("LapStore", () => {
    it("builds laps from counted crossings and skips rejected ones", () => {
        const s = new LapStore();
        s.reset("s1");
        s.ingest(crossing(0, 1, null));
        s.ingest(crossing(20, 0, null, "REJECTED_SLOW"));
        s.ingest(crossing(41.5, 2, 41_512.345));
        s.ingest(crossing(80, 3, 38_400.001));

        expect(s.laps().map((l) => [l.number, l.ms])).toEqual([
            [1, 41_512.345],
            [2, 38_400.001],
        ]);
        expect(bestLap(s.laps())?.number).toBe(2);
        expect(s.running()).toEqual({ number: 3, startMs: T0 + 80_000 });
        expect(s.barrier()).toEqual({ lat: 48.1, lon: 11.5 });
    });

    it("has no running lap after a single-mode lap end", () => {
        const s = new LapStore();
        s.reset("s1");
        s.ingest(crossing(0, 1, null));
        s.ingest(crossing(40, 0, 40_000));
        expect(s.laps()).toHaveLength(1);
        expect(s.running()).toBeNull();
    });

    it("dedupes resends, keeps time order and drops other sessions", () => {
        const s = new LapStore();
        s.reset("s1");
        const a = crossing(0, 1, null);
        const b = crossing(40, 2, 40_000);
        s.ingest(b);
        s.ingest(a); // late outbox resend
        s.ingest(a);
        s.ingest(crossing(50, 3, 10_000, "ACCEPTED", "s2"));
        expect(s.crossings.map((c) => c.crossingId)).toEqual([a.crossingId, b.crossingId]);
    });

    it("merges the database seed with live crossings", () => {
        const s = new LapStore();
        s.reset("s1");
        const live = crossing(40, 2, 40_000);
        s.ingest(live);
        s.seed("s1", [crossing(0, 1, null), live]);
        expect(s.crossings).toHaveLength(2);
        expect(s.laps()).toHaveLength(1);
    });
});

describe("formatLapTime", () => {
    it("formats seconds and minutes", () => {
        expect(formatLapTime(41_512.345)).toBe("41.512");
        expect(formatLapTime(9_005)).toBe("9.005");
        expect(formatLapTime(61_005)).toBe("1:01.005");
        expect(formatLapTime(83_400.5)).toBe("1:23.400");
        expect(formatLapTime(83_456, 1)).toBe("1:23.5");
    });
});
