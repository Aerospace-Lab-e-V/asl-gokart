/*
 * Everything the UI can ask an ECU to do. Main routes each command to the adapter that owns the ECU.
 * State never changes because a command succeeded: it changes when the ECU echoes the new state as a signal.
 */

import type { AnimationLayer, Rgb } from "@/domain/lights";

/** Lights the firmware toggles. */
export type ToggleLight = "turn_left" | "turn_right" | "hazard" | "drl" | "high_beam" | "tail" | "brake" | "reverse";

/** Lights that can also be set to a state. */
export type SettableLight = "drl" | "high_beam" | "tail" | "brake" | "reverse";

export type Command =
    | { type: "lights.toggle"; light: ToggleLight }
    | { type: "lights.set"; light: SettableLight; on: boolean }
    /** Plays the welcome animation now; refused while moving or while brake/reverse/turn is on. */
    | { type: "lights.welcome" }
    /** Welcome settings; at least one field. Ambient is 0-255 and dims the welcome only. */
    | { type: "lights.setWelcome"; enabled?: boolean; front?: number; rear?: number; ambient?: number }
    /** Colour of one custom-colour animation. */
    | { type: "lights.setAnimationColor"; layer: AnimationLayer; id: number; rgb: Rgb }
    /** Relay index as the firmware counts: 0 = relay 1, 1 = relay 2. */
    | { type: "motor.toggleRelay"; relay: 0 | 1 };

export type CommandType = Command["type"];

export type CommandResult = { ok: true } | { ok: false; error: string };
