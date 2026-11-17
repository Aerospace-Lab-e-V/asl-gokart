// Port of zc/zc_lights/src/animations/front/glow.hpp — keep in sync.
import type { Canvas1D } from "../../canvas";

export const FADE_MS = 3000;

export function render(t: number, out: Canvas1D): void {
    out.fill(t / FADE_MS);
}
