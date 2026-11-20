import type { Rgb } from "@/domain/lights";
import { FRONT_RENDER, REAR_RENDER } from "./animations";
import { Canvas1D, Canvas2D } from "./canvas";
import { composeFront, composeRear, type Turn } from "./compositor";
import { FRONT, REAR } from "./layout";
import { draws, sampleFront, sampleRear, welcomeActive, type WelcomePlan } from "./welcome-plan";

/*
 * Everything the kart's lights show at one moment, rendered exactly like zc_lights does
 * (same animations, timeline and compositor), into RGBA buffers for the canvases.
 */

export interface LightState {
    drl: boolean;
    tail: boolean;
    brake: boolean;
    reverse: boolean;
    turn: Turn;
    turnEpoch: number;
}

export const DARK_STATE: LightState = { drl: false, tail: false, brake: false, reverse: false, turn: "off", turnEpoch: 0 };

export class LightScene {
    /** RGBA per LED; index 0 = inner end. */
    readonly frontLeft = new Uint8ClampedArray(FRONT.NUM_LEDS * 4);
    readonly frontRight = new Uint8ClampedArray(FRONT.NUM_LEDS * 4);
    /** RGBA, row-major 144 × 3, column 0 = left seen from behind. */
    readonly rear = new Uint8ClampedArray(REAR.WIDTH * REAR.HEIGHT * 4);

    private frontCanvas = new Canvas1D(FRONT.NUM_LEDS);
    private rearCanvas = new Canvas2D(REAR.WIDTH, REAR.HEIGHT);

    /** Renders the frame; returns true while something moves (welcome or a turn signal). */
    render(now: number, s: LightState, plan: WelcomePlan | null): boolean {
        const fs = sampleFront(plan, now);
        const rs = sampleRear(plan, now);
        const color: Rgb = plan?.frontColor ?? [0, 0, 0];
        const ambient = plan?.ambient ?? 255;
        if (plan && draws(fs)) FRONT_RENDER[plan.front.id]?.(fs.localT, this.frontCanvas);
        if (plan && draws(rs)) REAR_RENDER[plan.rear.id]?.(rs.localT, this.rearCanvas);

        const left = s.turn === "left" || s.turn === "hazard";
        const right = s.turn === "right" || s.turn === "hazard";
        composeFront({ drl: s.drl, turn: left, turnEpoch: s.turnEpoch }, fs, this.frontCanvas, color, ambient, now, this.frontLeft);
        composeFront({ drl: s.drl, turn: right, turnEpoch: s.turnEpoch }, fs, this.frontCanvas, color, ambient, now, this.frontRight);
        composeRear(s, rs, this.rearCanvas, plan?.rearColor ?? [0, 0, 0], ambient, now, this.rear);

        return welcomeActive(plan, now) || s.turn !== "off";
    }
}

/** One layer's animation on its own (no base light), for the picker tiles. */
export function renderAnimationOnly(
    layer: "front" | "rear",
    id: number,
    t: number,
    color: Rgb,
    front: Canvas1D,
    rear: Canvas2D,
    out: Uint8ClampedArray,
): void {
    const ls = { phase: "playing" as const, localT: t, alpha: 1 };
    if (layer === "front") {
        FRONT_RENDER[id]?.(t, front);
        composeFront({ drl: false, turn: false, turnEpoch: 0 }, ls, front, color, 255, 0, out);
    } else {
        REAR_RENDER[id]?.(t, rear);
        composeRear(DARK_STATE, ls, rear, color, 255, 0, out);
    }
}
