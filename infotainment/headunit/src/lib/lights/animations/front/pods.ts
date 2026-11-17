// Port of zc/zc_lights/src/animations/front/pods.hpp — keep in sync.
import type { Canvas1D } from "../../canvas";
import { smooth01 } from "../../easing";

export const POD_PX = 5;
export const STEP_MS = 250;
export const RISE_MS = 90;

export function render(t: number, out: Canvas1D): void {
    for (let i = 0; i < out.len; i++) {
        const pod = Math.floor(i / POD_PX);
        out.set(i, smooth01((t - pod * STEP_MS) / RISE_MS));
    }
}
