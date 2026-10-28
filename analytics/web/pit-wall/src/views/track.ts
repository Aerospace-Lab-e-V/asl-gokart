import type { Point } from "../live/store";

/** One GPS fix: lat/lon (and speed, when known) of the same kart-agent epoch. */
export interface TrackPoint {
    tMs: number;
    lat: number;
    lon: number;
    speed: number | null;
}

/** Upper bounds (km/h) of the trail's speed bins; the last bin is open. */
export const SPEED_BINS_KMH = [15, 30, 45, 60] as const;

/**
 * One blue ramp, light (slow) to dark (fast), steps 250–700 of the chart palette,
 * validated as an ordinal ramp. The map tiles are light in both themes, so there is
 * no dark-mode variant.
 */
export const SPEED_COLORS = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"] as const;

/** Segments without a speed sample. */
export const NO_SPEED_COLOR = "#898781";

/** Index into SPEED_COLORS, or -1 without a speed. */
export function speedBin(speed: number | null): number {
    if (speed === null || isNaN(speed)) return -1;
    const i = SPEED_BINS_KMH.findIndex((max) => speed < max);
    return i === -1 ? SPEED_BINS_KMH.length : i;
}

export function speedColor(speed: number | null): string {
    const bin = speedBin(speed);
    return bin === -1 ? NO_SPEED_COLOR : SPEED_COLORS[bin]!;
}

export function binLabel(bin: number): string {
    const lo = bin === 0 ? 0 : SPEED_BINS_KMH[bin - 1]!;
    const hi = SPEED_BINS_KMH[bin];
    return hi === undefined ? `${lo}+` : `${lo}–${hi}`;
}

/**
 * Joins the lat, lon and speed series (store points, sorted by time) into runs of
 * fixes newer than `sinceMs`. kart-agent stamps all signals of one fix with the same
 * time, so they join on equal `x`. A NaN point (a gap in either coordinate) or a
 * coordinate without its partner ends a run.
 */
export function trackRuns(
    lat: readonly Point[],
    lon: readonly Point[],
    speed: readonly Point[],
    sinceMs: number
): TrackPoint[][] {
    const runs: TrackPoint[][] = [];
    let run: TrackPoint[] = [];
    const endRun = () => {
        if (run.length > 0) runs.push(run);
        run = [];
    };
    let j = 0;
    let k = 0;
    for (const p of lat) {
        if (p.x < sinceMs) continue;
        if (isNaN(p.y)) {
            endRun();
            continue;
        }
        while (j < lon.length && lon[j]!.x < p.x) {
            if (isNaN(lon[j]!.y) && lon[j]!.x >= sinceMs) endRun();
            j++;
        }
        const q = lon[j];
        if (!q || q.x !== p.x || isNaN(q.y)) {
            endRun();
            continue;
        }
        while (k < speed.length && speed[k]!.x < p.x) k++;
        const s = speed[k];
        const v = s && s.x === p.x && !isNaN(s.y) ? s.y : null;
        run.push({ tMs: p.x, lat: p.y, lon: q.y, speed: v });
    }
    endRun();
    return runs;
}

export type LatLon = [number, number];

/**
 * Polylines per speed bin (index 0 = no speed, then SPEED_COLORS order). Each step
 * between two fixes takes the bin of the later fix; consecutive steps of one bin
 * form one line, so a run is drawn without gaps between colours.
 */
export function binLines(runs: readonly TrackPoint[][]): LatLon[][][] {
    const lines: LatLon[][][] = Array.from({ length: SPEED_COLORS.length + 1 }, () => []);
    for (const run of runs) {
        let current: LatLon[] | null = null;
        let currentBin = NaN;
        for (let i = 1; i < run.length; i++) {
            const a = run[i - 1]!;
            const b = run[i]!;
            const bin = speedBin(b.speed) + 1;
            if (current && bin === currentBin) {
                current.push([b.lat, b.lon]);
            } else {
                current = [
                    [a.lat, a.lon],
                    [b.lat, b.lon],
                ];
                currentBin = bin;
                lines[bin]!.push(current);
            }
        }
    }
    return lines;
}
