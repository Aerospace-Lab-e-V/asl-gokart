import { describe, expect, it } from "vitest";
import type { Point } from "../live/store";
import { binLabel, binLines, SPEED_COLORS, speedBin, trackRuns } from "./track";

const pts = (ys: [number, number][]): Point[] => ys.map(([x, y]) => ({ x, y }));

describe("trackRuns", () => {
    it("joins lat, lon and speed of the same fix", () => {
        const lat = pts([
            [0, 48.0],
            [200, 48.1],
        ]);
        const lon = pts([
            [0, 11.0],
            [200, 11.1],
        ]);
        const speed = pts([[200, 20]]);
        expect(trackRuns(lat, lon, speed, -Infinity)).toEqual([
            [
                { tMs: 0, lat: 48.0, lon: 11.0, speed: null },
                { tMs: 200, lat: 48.1, lon: 11.1, speed: 20 },
            ],
        ]);
    });

    it("breaks at gaps and at fixes missing a coordinate", () => {
        const lat = pts([
            [0, 1],
            [200, 2],
            [300, NaN],
            [400, 3],
            [600, 4],
            [800, 5],
        ]);
        const lon = pts([
            [0, 1],
            [200, 2],
            [300, NaN],
            [400, 3],
            [800, 5],
        ]);
        const runs = trackRuns(lat, lon, [], -Infinity);
        expect(runs.map((r) => r.map((p) => p.tMs))).toEqual([[0, 200], [400], [800]]);
    });

    it("keeps only fixes inside the window", () => {
        const lat = pts([
            [0, 1],
            [200, 2],
            [400, 3],
        ]);
        const runs = trackRuns(lat, lat, [], 200);
        expect(runs[0]!.map((p) => p.tMs)).toEqual([200, 400]);
    });
});

describe("speed bins", () => {
    it("cover 0 to 60+ km/h in the validated ramp", () => {
        expect(speedBin(null)).toBe(-1);
        expect(speedBin(0)).toBe(0);
        expect(speedBin(15)).toBe(1);
        expect(speedBin(59.9)).toBe(3);
        expect(speedBin(75)).toBe(SPEED_COLORS.length - 1);
        expect(binLabel(0)).toBe("0–15");
        expect(binLabel(SPEED_COLORS.length - 1)).toBe("60+");
    });

    it("draw each run without gaps between colours", () => {
        const run = [0, 10, 12, 40].map((speed, i) => ({ tMs: i, lat: i, lon: i, speed }));
        const lines = binLines([run]);
        // Steps to 10 and 12 km/h share one line in bin 0 (index 1); 40 km/h is bin 2.
        expect(lines[1]).toEqual([
            [
                [0, 0],
                [1, 1],
                [2, 2],
            ],
        ]);
        expect(lines[3]).toEqual([
            [
                [2, 2],
                [3, 3],
            ],
        ]);
        expect(lines.flat()).toHaveLength(2);
    });
});
