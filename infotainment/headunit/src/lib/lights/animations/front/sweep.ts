// Port of zc/zc_lights/src/animations/front/sweep.hpp — keep in sync.
import type { Canvas1D } from "../../canvas";
import { clamp01, easeInOut } from "../../easing";

export const FILL_MS = 1100;
export const EDGE_PX = 3;

export const fillAt = (head: number, i: number): number => clamp01((head - i) / EDGE_PX);

export function render(t: number, out: Canvas1D): void {
    const head = easeInOut(t / FILL_MS) * (out.len + EDGE_PX);
    for (let i = 0; i < out.len; i++) out.set(i, fillAt(head, i));
}
