// Port of zc/zc_lights/src/animations/rear/wing.hpp — keep in sync.
import type { Canvas2D } from "../../canvas";
import { clamp01, mixf, smooth01, smoothstep } from "../../easing";

export const BURST_S = 0.5;
export const SWEEP_S = 0.7;
export const CORE = 0.07;
export const COMB_PX = 3;
export const FALLOFF = 0.8;
export const END_FEATHER = 0.1;

export function column(tMs: number, col: number, w: number): number {
    const tb = tMs / 1000;
    const p1 = clamp01(tb / BURST_S);
    const p2e = smooth01((tb - BURST_S) / SWEEP_S);

    const half = w / 2;
    const d = Math.abs((col + 0.5 - half) / half);
    const feather = 0.25 * (1 - 0.6 * p2e);
    const radius = 0.5 * p1 + (0.5 + END_FEATHER) * p2e;

    let envelope = 1;
    if (d > radius) envelope = 0;
    else if (d > radius - feather && feather > 0) envelope = (radius - d) / feather;

    const distPx = Math.abs(col + 0.5 - half) - 0.5;
    const dot = Math.floor(Math.floor(distPx) / COMB_PX) % 2 === 0;
    const comb = d <= CORE || dot ? 1 : p2e;

    const falloff = mixf(1 - FALLOFF * smoothstep(CORE, 0.5, d), 1, p2e);
    return envelope * comb * falloff;
}

export function render(t: number, out: Canvas2D): void {
    for (let col = 0; col < out.w; col++) out.setColumn(col, column(t, col, out.w));
}
