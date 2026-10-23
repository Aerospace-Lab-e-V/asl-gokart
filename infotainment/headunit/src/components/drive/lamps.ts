import { Gears } from "@/data/controlling_models/drivetrain";

/** Lit lamp colours: yellow and orange warn, red is critical (incl. an ECU that is not connected). */
export type LampTone = "yellow" | "orange" | "red";

/** Temperature lamp: yellow from `warnC`, red above `hotC`; off below and while unknown. */
export const tempTone = (t: number | null, warnC: number, hotC: number): LampTone | null =>
    t === null ? null : t > hotC ? "red" : t >= warnC ? "yellow" : null;

/**
 * P until the main contactors (relay 1) are closed and current can flow, also while unknown; then R with reverse
 * engaged, else N. Nothing reports D yet.
 */
export const gearFor = (contactors: number | null, reverse: number | null): Gears =>
    contactors !== 1 ? Gears.p : reverse === 1 ? Gears.r : Gears.n;
