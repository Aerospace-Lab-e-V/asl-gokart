// Port of zc/zc_lights/src/animations/front/scan.hpp — keep in sync.
import type { Canvas1D } from "../../canvas";
import { clamp01, easeInOut } from "../../easing";
import { EDGE_PX, fillAt } from "./sweep";

export const LEG_MS = 500;
export const FILL_MS = 600;
export const TAIL_PX = 1.5;

export function render(t: number, out: Canvas1D): void {
    const last = out.len - 1;
    if (t < 2 * LEG_MS) {
        const outward = t < LEG_MS;
        const k = (outward ? t : t - LEG_MS) / LEG_MS;
        const head = outward ? k * last : (1 - k) * last;
        for (let i = 0; i < out.len; i++) {
            const behind = outward ? head - i : i - head;
            out.set(i, behind >= 0 ? Math.exp(-behind / TAIL_PX) : clamp01(1 + behind));
        }
        return;
    }
    const head = easeInOut((t - 2 * LEG_MS) / FILL_MS) * (out.len + EDGE_PX);
    for (let i = 0; i < out.len; i++) out.set(i, fillAt(head, i));
}
