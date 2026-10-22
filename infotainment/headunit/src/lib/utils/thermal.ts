import { TEMP_BOUNDARIES } from "@/data/battery-config";
import type { Segment } from "@/data/gauge-config";
import { interpolateColor } from "@/lib/utils/gauge-utils";
import { hexToRgb } from "@/lib/utils";

const [MIN, MAX] = TEMP_BOUNDARIES;

/** Colour of a temperature on the temperature segments, clamped to TEMP_BOUNDARIES. */
export const tempRgb = (t: number, segments: Segment[]): [number, number, number] => hexToRgb(interpolateColor(t, MIN, MAX, segments));

/** Where a temperature sits within TEMP_BOUNDARIES, 0-100 %. */
export const tempScalePct = (t: number): number => ((Math.max(MIN, Math.min(t, MAX)) - MIN) / (MAX - MIN)) * 100;

/**
 * Temperatures over a `w` x `h` raster (row by row) from sensors sitting at the centres of a `cols` x `rows` grid,
 * bilinear between neighbouring sensors and flat beyond the outer ones. A missing sensor takes the mean of the
 * valid ones rather than painting a cold spot; null when no sensor is valid.
 */
export function thermalField(temps: (number | null)[], cols: number, rows: number, w: number, h: number): Float32Array | null {
    const valid = temps.filter((t): t is number => t !== null);
    if (!valid.length) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const at = (col: number, row: number) => temps[row * cols + col] ?? mean;

    // Raster pixel centre in grid units, measured from the first sensor's centre.
    const axis = (i: number, size: number, cells: number) => {
        const g = Math.max(0, Math.min(((i + 0.5) / size) * cells - 0.5, cells - 1));
        const i0 = Math.min(Math.floor(g), Math.max(0, cells - 2));
        return { i0, i1: Math.min(i0 + 1, cells - 1), f: g - i0 };
    };

    const field = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const r = axis(y, h, rows);
        for (let x = 0; x < w; x++) {
            const c = axis(x, w, cols);
            const top = at(c.i0, r.i0) * (1 - c.f) + at(c.i1, r.i0) * c.f;
            const bottom = at(c.i0, r.i1) * (1 - c.f) + at(c.i1, r.i1) * c.f;
            field[y * w + x] = top * (1 - r.f) + bottom * r.f;
        }
    }
    return field;
}
