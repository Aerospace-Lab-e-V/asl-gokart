import type { Sample } from "@/domain/signals";
import { BATTERY_MAX_VOLTAGE, BATTERY_MIN_VOLTAGE } from "@/data/battery-config";

/*
 * Signals the headunit derives from decoded ones (rule 4), mirroring analytics/crates/ecu-sero/src/decoder.rs
 * where it derives the same thing. Called by the adapters right after decoding.
 */

/** Motors drive the wheels directly, so motor rpm is wheel rpm (decoder.rs WHEEL_CIRCUMFERENCE_M). */
export const WHEEL_CIRCUMFERENCE_M = 1.415;

/** Voltage and current arrive separately and only on change; past this age a held value is gone (decoder.rs HOLD_US). */
export const HOLD_MS = 5000;

/** Temperature the battery firmware sends for a disconnected or faulty sensor (ecu-sero INVALID_TEMP_C). */
export const INVALID_TEMP_C = -127;

/** How long `lights.hazard` stays on after the last `[1, 1]` turn event; must exceed one blink period. */
export const HAZARD_HOLD_MS = 1200;

/** km/h from the two motor rpms. */
export const speedKmh = (rpmLeft: number, rpmRight: number): number =>
    ((rpmLeft + rpmRight) / 2 / 60) * WHEEL_CIRCUMFERENCE_M * 3.6;

/** Pedal position 0-100 %. A controller that stops answering reports zeros, so the higher reading wins. */
export const throttlePercent = (rawLeft: number, rawRight: number): number => (Math.max(rawLeft, rawRight) / 255) * 100;

/** State of charge 0-100 % from pack voltage (linear between the configured limits). */
export function socFromVoltage(voltage: number): number {
    const soc = ((voltage - BATTERY_MIN_VOLTAGE) / (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)) * 100;
    return Math.min(100, Math.max(0, soc));
}

/**
 * kW from the held voltage and current, `null` unless both are fresh. Both arrive only on change, so a steady
 * voltage (e.g. while charging) is still the current one: it is held until zc_battery is lost, not for a fixed
 * age. decoder.rs drops it after HOLD_US instead, which leaves gaps in logged power.
 */
export function powerKw(voltage: Sample | undefined, current: Sample | undefined): number | null {
    const held = (s: Sample | undefined) => (s && !s.stale ? s.value : undefined);
    const v = held(voltage);
    const c = held(current);
    return v === undefined || c === undefined ? null : (v * c) / 1000;
}

export const isValidTemp = (t: number): boolean => t !== INVALID_TEMP_C && Number.isFinite(t);

/** Stats over the valid sensors; every field `null` when there is none (A2: no NaN/Infinity). */
export function tempStats(valid: number[]): { max: number | null; min: number | null; avg: number | null } {
    if (!valid.length) return { max: null, min: null, avg: null };
    return {
        max: Math.max(...valid),
        min: Math.min(...valid),
        avg: valid.reduce((a, b) => a + b, 0) / valid.length,
    };
}

let hazardTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * `lights.hazard` from turn events (B9). The firmware only sends the lamps' blink state, so: `[1, 1]` means
 * hazard; it stays on through the blink-off phase `[0, 0]` until no `[1, 1]` came for HAZARD_HOLD_MS or one
 * side blinks alone.
 * ponytail: inferred from the blink pattern, so hazard reads 1 for up to HAZARD_HOLD_MS after it was switched
 * off; a hazard event from zc_lights replaces this.
 */
export function hazardFromTurn(left: number, right: number, set: (on: number) => void): void {
    if (left && right) {
        clearTimeout(hazardTimer);
        hazardTimer = setTimeout(() => {
            hazardTimer = undefined;
            set(0);
        }, HAZARD_HOLD_MS);
        set(1);
    } else if (left || right || !hazardTimer) {
        clearTimeout(hazardTimer);
        hazardTimer = undefined;
        set(0);
    }
}

/** Forgets held state, e.g. when the adapter stops. */
export function resetDerive(): void {
    clearTimeout(hazardTimer);
    hazardTimer = undefined;
}
