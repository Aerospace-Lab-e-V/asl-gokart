// Port of zc/zc_lights/src/core/compositor.hpp — keep in sync.
import type { Rgb } from "@/domain/lights";
import type { Canvas1D, Canvas2D } from "./canvas";
import { GAMMA22 } from "./gamma";
import { FRONT, REAR, blinkAt, inCenter, inReverse } from "./layout";
import { draws, type LayerSample } from "./welcome-plan";

/*
 * One frame from the light state. Layers, bottom to top: base (DRL / tail), welcome (gamma → ambient →
 * colour, blended by alpha), safety (brake, reverse, turn; opaque in their zone).
 * Output is RGBA (4 bytes per pixel) so it can go straight into an ImageData.
 */

export type Turn = "off" | "left" | "right" | "hazard";
const blinksLeft = (t: Turn) => t === "left" || t === "hazard";
const blinksRight = (t: Turn) => t === "right" || t === "hazard";

const OFF: Rgb = [0, 0, 0];
const level = ([r, g, b]: Rgb, brightness: number): Rgb => {
    const k = brightness / 255;
    return [r * k, g * k, b * k];
};

function put(out: Uint8ClampedArray, i: number, [r, g, b]: Rgb): void {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
}

/** base → welcome pixel by alpha. */
function blend(out: Uint8ClampedArray, i: number, base: Rgb, intensity: number, color: Rgb, ambient: number, alpha: number): void {
    const k = (GAMMA22[intensity] / 255) * (ambient / 255);
    out[i * 4] = base[0] + (color[0] * k - base[0]) * alpha;
    out[i * 4 + 1] = base[1] + (color[1] * k - base[1]) * alpha;
    out[i * 4 + 2] = base[2] + (color[2] * k - base[2]) * alpha;
    out[i * 4 + 3] = 255;
}

export interface FrontInputs {
    drl: boolean;
    /** This side's indicator is on. */
    turn: boolean;
    turnEpoch: number;
}

export function composeFront(
    input: FrontInputs,
    ls: LayerSample,
    welcome: Canvas1D,
    color: Rgb,
    ambient: number,
    now: number,
    out: Uint8ClampedArray,
): void {
    const n = welcome.len;
    if (input.turn) {
        const b = blinkAt(now, input.turnEpoch);
        const lit = b.lit ? Math.round(b.progress * n) : 0;
        const turn = level(FRONT.COLOR_TURN, FRONT.BRIGHTNESS_TURN);
        for (let i = 0; i < n; i++) put(out, i, i < lit ? turn : OFF);
        return;
    }
    const base = input.drl ? level(FRONT.COLOR_DRL, FRONT.BRIGHTNESS_DRL) : OFF;
    for (let i = 0; i < n; i++) {
        if (draws(ls)) blend(out, i, base, welcome.get(i), color, ambient, ls.alpha);
        else put(out, i, base);
    }
}

export interface RearInputs {
    tail: boolean;
    brake: boolean;
    reverse: boolean;
    turn: Turn;
    turnEpoch: number;
}

export function composeRear(
    input: RearInputs,
    ls: LayerSample,
    welcome: Canvas2D,
    color: Rgb,
    ambient: number,
    now: number,
    out: Uint8ClampedArray,
): void {
    const b = blinkAt(now, input.turnEpoch);
    const turning = input.turn !== "off" && b.lit;
    const turnLit = Math.round(b.progress * REAR.TURN_SIGNAL_WIDTH);
    const tail = level(REAR.COLOR_TAIL, REAR.BRIGHTNESS_TAIL);
    const brake = level(REAR.COLOR_BRAKE, REAR.BRIGHTNESS_BRAKE);
    const reverse = level(REAR.COLOR_REVERSE, REAR.BRIGHTNESS_REVERSE);
    const turn = level(REAR.COLOR_TURN, REAR.BRIGHTNESS_TURN);
    const welcomeOn = draws(ls);

    for (let col = 0; col < REAR.WIDTH; col++) {
        let safe: Rgb | null = null;
        if (turning && blinksLeft(input.turn) && col < REAR.TURN_LEFT_END) {
            safe = REAR.TURN_LEFT_END - 1 - col < turnLit ? turn : OFF;
        } else if (turning && blinksRight(input.turn) && col >= REAR.TURN_RIGHT_START) {
            safe = col - REAR.TURN_RIGHT_START < turnLit ? turn : OFF;
        } else if (input.reverse && inReverse(col)) {
            safe = reverse;
        } else if (input.brake && inCenter(col)) {
            safe = brake;
        }
        const base = input.tail && inCenter(col) ? tail : OFF;
        for (let row = 0; row < REAR.HEIGHT; row++) {
            const i = row * REAR.WIDTH + col;
            if (safe) put(out, i, safe);
            else if (welcomeOn) blend(out, i, base, welcome.get(col, row), color, ambient, ls.alpha);
            else put(out, i, base);
        }
    }
}
