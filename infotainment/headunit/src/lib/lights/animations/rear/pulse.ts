// Port of zc/zc_lights/src/animations/rear/pulse.hpp — keep in sync.
import type { Canvas2D } from "../../canvas";
import { clamp01, mixf } from "../../easing";
import { inCenter } from "../../layout";

export const BREATH_MS = 1100;
export const BREATHS = 2;
export const RAMP_MS = 400;
export const SIGMA_FROM = 0.2;
export const SIGMA_TO = 0.8;
export const TAIL_MATCH = 0.59;

export function render(t: number, out: Canvas2D): void {
    const breatheMs = BREATHS * BREATH_MS;
    const half = out.w / 2;
    if (t < breatheMs) {
        const b = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / BREATH_MS);
        const sigma = mixf(SIGMA_FROM, SIGMA_TO, t / breatheMs);
        for (let col = 0; col < out.w; col++) {
            const x = (col + 0.5 - half) / half / sigma;
            out.setColumn(col, b * Math.exp(-x * x));
        }
        return;
    }
    const k = clamp01((t - breatheMs) / RAMP_MS);
    for (let col = 0; col < out.w; col++) out.setColumn(col, inCenter(col) ? k * TAIL_MATCH : 0);
}
