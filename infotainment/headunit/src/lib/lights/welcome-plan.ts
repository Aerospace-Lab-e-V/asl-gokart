// Port of zc/zc_lights/src/core/welcome_plan.hpp — keep in sync.
import { WELCOME, type AnimationInfo, type Rgb } from "@/domain/lights";

/*
 * Timeline of one welcome: the front starts, the rear starts at the front's cue, both hold until the
 * later one is done and then settle into DRL / tail together. A cancel fades out from wherever it was.
 */

export interface WelcomePlan {
    t0: number;
    front: AnimationInfo;
    rear: AnimationInfo;
    frontColor: Rgb;
    rearColor: Rgb;
    ambient: number;
    cancelAt?: number;
}

export type LayerPhase = "idle" | "waiting" | "playing" | "holding" | "settling" | "cancelling";

export interface LayerSample {
    phase: LayerPhase;
    /** Time to render the animation at. */
    localT: number;
    /** Weight of the welcome over the base light. */
    alpha: number;
}

const IDLE: LayerSample = { phase: "idle", localT: 0, alpha: 0 };

export const draws = (s: LayerSample) => s.phase !== "idle" && s.phase !== "waiting";

export const welcomeEndMs = (p: WelcomePlan) => Math.max(p.front.durationMs, (p.front.cueMs ?? p.front.durationMs) + p.rear.durationMs);

const ramp = (t: number, len: number) => (t <= 0 ? 0 : t >= len ? 1 : t / len);

function sampleLayer(p: WelcomePlan, now: number, offset: number, dur: number): LayerSample {
    const e = now - p.t0;
    const end = welcomeEndMs(p);
    const local = e - offset;
    if (local < 0) return { phase: "waiting", localT: 0, alpha: 0 };
    if (local < dur) return { phase: "playing", localT: local, alpha: ramp(local, WELCOME.XFADE_IN_MS) };
    if (e < end) return { phase: "holding", localT: dur, alpha: 1 };
    if (e < end + WELCOME.SETTLE_MS) return { phase: "settling", localT: dur, alpha: 1 - ramp(e - end, WELCOME.SETTLE_MS) };
    return IDLE;
}

function sample(p: WelcomePlan | null, now: number, offset: number, dur: number): LayerSample {
    if (!p) return IDLE;
    if (p.cancelAt === undefined) return sampleLayer(p, now, offset, dur);
    const since = now - p.cancelAt;
    if (since >= WELCOME.CANCEL_FADE_MS) return IDLE;
    const atCancel = sampleLayer(p, p.cancelAt, offset, dur);
    if (!draws(atCancel)) return IDLE;
    return { phase: "cancelling", localT: atCancel.localT, alpha: atCancel.alpha * (1 - ramp(since, WELCOME.CANCEL_FADE_MS)) };
}

export const sampleFront = (p: WelcomePlan | null, now: number) => sample(p, now, 0, p?.front.durationMs ?? 0);
export const sampleRear = (p: WelcomePlan | null, now: number) => sample(p, now, p?.front.cueMs ?? 0, p?.rear.durationMs ?? 0);

export function welcomeActive(p: WelcomePlan | null, now: number): boolean {
    if (!p) return false;
    if (p.cancelAt !== undefined) return now - p.cancelAt < WELCOME.CANCEL_FADE_MS;
    return now - p.t0 < welcomeEndMs(p) + WELCOME.SETTLE_MS;
}
