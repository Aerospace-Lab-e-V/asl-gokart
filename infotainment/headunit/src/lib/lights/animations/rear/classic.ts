// Port of zc/zc_lights/src/animations/rear/classic.hpp — keep in sync.
import type { Canvas2D } from "../../canvas";
import { clamp01 } from "../../easing";

export const PHASE_MS = 800;
export const DIM = 0.73;

export function render(t: number, out: Canvas2D): void {
    const half = out.w / 2;
    const reached = (start: number) => (t < start ? 0 : Math.floor(clamp01((t - start) / PHASE_MS) * half));
    const r1 = reached(0);
    const r2 = reached(PHASE_MS);
    const r3 = reached(2 * PHASE_MS);
    const middle = Math.floor(out.h / 2);

    for (let col = 0; col < out.w; col++) {
        const fromCenter = col < half ? half - 1 - col : col - half;
        const fromEdge = col < half ? col : out.w - 1 - col;
        for (let row = 0; row < out.h; row++) {
            let i = 0;
            if (row === middle && fromCenter < r1) i = DIM;
            if (fromEdge < r2) i = DIM;
            if (fromCenter < r3) i = 1;
            out.set(col, row, i);
        }
    }
}
