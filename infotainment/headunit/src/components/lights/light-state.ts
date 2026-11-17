import { create } from "zustand";
import { colorSignal, findAnimation, numberToRgb, WELCOME, type Rgb } from "@/domain/lights";
import type { SignalName } from "@/domain/signals";
import { readSignal, useSignals } from "@/stores/signals";
import type { Turn } from "@/lib/lights/compositor";
import type { LightState } from "@/lib/lights/scene";
import type { WelcomePlan } from "@/lib/lights/welcome-plan";

/*
 * The kart's real light state for the live visual, read from the signals at frame time.
 * zc_lights reports the physical blink (on, off, on…), so an indicator counts as on until a
 * blink cycle passes without it; the sweep restarts at the first edge.
 */

const TURN_HOLD_MS = 1000;
const turnMemory = { leftAt: -Infinity, rightAt: -Infinity, hazardAt: -Infinity, epoch: 0, active: false };

const onAt = (name: SignalName): number | null => {
    const s = useSignals.getState()[name];
    return s && !s.stale && s.value === 1 ? s.ts : null;
};

export function readLightState(now: number): LightState {
    const m = turnMemory;
    m.leftAt = onAt("lights.turn_left") ?? m.leftAt;
    m.rightAt = onAt("lights.turn_right") ?? m.rightAt;
    m.hazardAt = onAt("lights.hazard") ?? m.hazardAt;
    const left = now - m.leftAt < TURN_HOLD_MS;
    const right = now - m.rightAt < TURN_HOLD_MS;
    const hazard = now - m.hazardAt < TURN_HOLD_MS;
    const turn: Turn = hazard || (left && right) ? "hazard" : left ? "left" : right ? "right" : "off";
    if (turn !== "off" && !m.active) m.epoch = Math.max(m.leftAt, m.rightAt, m.hazardAt);
    m.active = turn !== "off";

    return {
        drl: readSignal("lights.drl") === 1,
        tail: readSignal("lights.tail") === 1,
        brake: readSignal("lights.brake") === 1,
        reverse: readSignal("lights.reverse") === 1,
        turn,
        turnEpoch: m.epoch,
    };
}

/** The colour an animation plays in: the user's colour from the ECU, else its default. */
export function animationColor(layer: "front" | "rear", id: number | null): Rgb | null {
    const a = findAnimation(layer, id);
    if (!a) return null;
    if (!a.customColor) return [...a.defaultColor];
    const n = readSignal(colorSignal(a));
    return n === null ? [...a.defaultColor] : numberToRgb(n);
}

/** A plan for the welcome with the ECU's current settings, starting at t0. */
export function planFromSettings(t0: number): WelcomePlan | null {
    const front = findAnimation("front", readSignal("lights.welcome_front"));
    const rear = findAnimation("rear", readSignal("lights.welcome_rear"));
    if (!front || !rear) return null;
    return {
        t0,
        front,
        rear,
        frontColor: animationColor("front", front.id) ?? [...front.defaultColor],
        rearColor: animationColor("rear", rear.id) ?? [...rear.defaultColor],
        ambient: readSignal("lights.ambient") ?? 255,
    };
}

/*
 * The welcome on the kart: when zc_lights reports it playing, the same plan starts here; when it
 * stops early (brake, turn, …) the plan fades out like on the kart.
 */
const useSyncedPlan = create<{ plan: WelcomePlan | null }>(() => ({ plan: null }));

useSignals.subscribe((s, prev) => {
    const playing = s["lights.welcome_playing"];
    const before = prev["lights.welcome_playing"];
    if (!playing || playing.stale || playing === before) return;
    if (playing.value === 1 && before?.value !== 1) {
        useSyncedPlan.setState({ plan: planFromSettings(playing.ts + WELCOME.START_LEAD_MS) });
    } else if (playing.value === 0) {
        const p = useSyncedPlan.getState().plan;
        if (p && p.cancelAt === undefined) useSyncedPlan.setState({ plan: { ...p, cancelAt: playing.ts } });
    }
});

export const useSyncedWelcome = (): WelcomePlan | null => useSyncedPlan((s) => s.plan);
