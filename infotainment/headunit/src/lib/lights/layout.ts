// Port of zc/zc_lights/src/core/light_layout.hpp and core/blink.hpp — keep in sync.
import type { Rgb } from "@/domain/lights";

/**
 * Indicator colour as drawn on screen. The LEDs need [255, 40, 0] to look orange (they are not true
 * colour), but on a display that is hardly distinguishable from the red tail/brake light, so the
 * preview uses a yellower orange. Not a firmware value.
 */
const PREVIEW_COLOR_TURN: Rgb = [255, 160, 0];

export const FRONT = {
    NUM_LEDS: 15,
    BRIGHTNESS_DRL: 128,
    BRIGHTNESS_TURN: 128,
    COLOR_DRL: [255, 255, 255] as Rgb,
    COLOR_TURN: PREVIEW_COLOR_TURN,
} as const;

/** Rear bar: 144 × 3, column 0 = left seen from behind. */
export const REAR = {
    WIDTH: 144,
    HEIGHT: 3,
    TURN_SIGNAL_WIDTH: 36,
    TURN_LEFT_END: 36,
    TURN_RIGHT_START: 108,
    CENTER_START: 36,
    CENTER_END: 108,
    REVERSE_LEFT_END: 54,
    REVERSE_RIGHT_START: 90,
    BRIGHTNESS_TAIL: 80,
    BRIGHTNESS_BRAKE: 255,
    BRIGHTNESS_REVERSE: 200,
    BRIGHTNESS_TURN: 255,
    COLOR_TAIL: [255, 0, 0] as Rgb,
    COLOR_BRAKE: [255, 0, 0] as Rgb,
    COLOR_TURN: PREVIEW_COLOR_TURN,
    COLOR_REVERSE: [255, 255, 255] as Rgb,
} as const;

export const inCenter = (col: number) => col >= REAR.CENTER_START && col < REAR.CENTER_END;
export const inReverse = (col: number) =>
    (col >= REAR.CENTER_START && col < REAR.REVERSE_LEFT_END) || (col >= REAR.REVERSE_RIGHT_START && col < REAR.CENTER_END);

export const BLINK = { SWEEP_MS: 400, HOLD_MS: 20, CYCLE_MS: 700 } as const;

/** Turn signal timing from the moment it was switched on: lit while sweeping and holding, then dark. */
export function blinkAt(nowMs: number, epochMs: number): { lit: boolean; progress: number } {
    const t = (((nowMs - epochMs) % BLINK.CYCLE_MS) + BLINK.CYCLE_MS) % BLINK.CYCLE_MS;
    if (t < BLINK.SWEEP_MS) return { lit: true, progress: t / BLINK.SWEEP_MS };
    if (t < BLINK.SWEEP_MS + BLINK.HOLD_MS) return { lit: true, progress: 1 };
    return { lit: false, progress: 0 };
}
