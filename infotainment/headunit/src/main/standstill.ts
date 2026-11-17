import { getFresh } from "@/main/signal-hub";
import { isAdmin } from "@/main/admin";

/** Below this speed (km/h) the kart counts as standing still. */
export const STANDSTILL_KMH = 0.5;

/**
 * Flashing reboots the ECU, so the kart must be standing still, judged on a fresh speed sample only.
 * TODO: with zc_motor offline there is no speed, so nothing can be flashed, including zc_motor itself
 * when its firmware is broken. That needs an explicit override later.
 */
export function assertKartStopped(): void {
    const speed = getFresh("drive.speed");
    if (speed === undefined) {
        throw new Error("No fresh speed from the Motor Controller, so the kart cannot be confirmed standing still.");
    }
    if (Math.abs(speed) >= STANDSTILL_KMH) {
        throw new Error(`The kart is moving (${speed.toFixed(1)} km/h). Stop before flashing.`);
    }
}

/**
 * The welcome may be played at a standstill. Without a speed (zc_motor offline, e.g. on an exhibition
 * booth) only admin mode may play it. zc_lights checks again with its own motor data.
 */
export function assertWelcomeAllowed(): void {
    const speed = getFresh("drive.speed");
    if (speed === undefined) {
        if (isAdmin()) return;
        throw new Error("No speed from the Motor Controller. Unlock admin mode to play the welcome without it.");
    }
    if (Math.abs(speed) >= STANDSTILL_KMH) throw new Error("The welcome can only play while the kart stands still.");
}
