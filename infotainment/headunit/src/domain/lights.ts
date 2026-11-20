import type { SignalName } from "@/domain/signals";

/*
 * Welcome-light animations the headunit knows. Mirrors zc/zc_lights/src/animations/registry.hpp
 * (ids, names, timings, default colours); keep both in sync. The firmware reports which ids it has
 * (lights.front_anims / lights.rear_anims), so an animation missing on either side is simply not offered.
 */

export type AnimationLayer = "front" | "rear";
export type Rgb = [number, number, number];

export interface AnimationInfo {
    /** Stable id, stored on the ECU. */
    id: number;
    key: string;
    name: string;
    layer: AnimationLayer;
    durationMs: number;
    /** Front only: when the rear animation starts. */
    cueMs?: number;
    /** The user may pick its colour; otherwise it always plays in `defaultColor`. */
    customColor: boolean;
    defaultColor: Rgb;
}

const BLUE: Rgb = [0, 100, 255];

export const FRONT_ANIMATIONS = [
    { id: 0, key: "glow", name: "Glow", layer: "front", durationMs: 3500, cueMs: 3000, customColor: true, defaultColor: BLUE },
    { id: 1, key: "pods", name: "Pods", layer: "front", durationMs: 1300, cueMs: 600, customColor: true, defaultColor: [255, 255, 255] },
    { id: 2, key: "sweep", name: "Sweep", layer: "front", durationMs: 1500, cueMs: 1100, customColor: true, defaultColor: BLUE },
    { id: 3, key: "scan", name: "Scan", layer: "front", durationMs: 2200, cueMs: 1600, customColor: true, defaultColor: BLUE },
] as const satisfies readonly AnimationInfo[];

export const REAR_ANIMATIONS = [
    { id: 0, key: "classic", name: "Classic sweep", layer: "rear", durationMs: 2400, customColor: true, defaultColor: BLUE },
    { id: 1, key: "wing", name: "CCGT Wing", layer: "rear", durationMs: 1700, customColor: false, defaultColor: [255, 0, 0] },
    { id: 2, key: "pulse", name: "Pulse", layer: "rear", durationMs: 2600, customColor: true, defaultColor: [255, 0, 0] },
] as const satisfies readonly AnimationInfo[];

export const ANIMATIONS: Record<AnimationLayer, readonly AnimationInfo[]> = { front: FRONT_ANIMATIONS, rear: REAR_ANIMATIONS };

export const findAnimation = (layer: AnimationLayer, id: number | null | undefined): AnimationInfo | undefined =>
    ANIMATIONS[layer].find((a) => a.id === id);

/** Welcome timeline constants, as zc_lights/src/core/welcome_plan.hpp. */
export const WELCOME = { START_LEAD_MS: 20, XFADE_IN_MS: 200, SETTLE_MS: 400, CANCEL_FADE_MS: 120 } as const;

/** From the first front frame until both ends have settled into DRL / tail. */
export function welcomeTotalMs(front: AnimationInfo, rear: AnimationInfo): number {
    return Math.max(front.durationMs, (front.cueMs ?? front.durationMs) + rear.durationMs) + WELCOME.SETTLE_MS;
}

/** Signal holding the user colour of an animation as 0xRRGGBB. Only custom-colour animations have one. */
export const colorSignal = (a: Pick<AnimationInfo, "layer" | "key">): SignalName => `lights.color.${a.layer}.${a.key}` as SignalName;

/** Signal holding the bitmask (bit = id) of the ids the firmware has. */
export const catalogSignal = (layer: AnimationLayer): SignalName => (layer === "front" ? "lights.front_anims" : "lights.rear_anims");

/** Signal holding the selected animation id. */
export const selectedSignal = (layer: AnimationLayer): SignalName => (layer === "front" ? "lights.welcome_front" : "lights.welcome_rear");

export const rgbToNumber = ([r, g, b]: Rgb): number => (r << 16) | (g << 8) | b;
export const numberToRgb = (n: number): Rgb => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
export const rgbToHex = (rgb: Rgb): string => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
