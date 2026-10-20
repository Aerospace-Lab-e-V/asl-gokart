/*
 * Everything the UI can ask an ECU to do. Main routes each command to the adapter that owns the ECU.
 * State never changes because a command succeeded: it changes when the ECU echoes the new state as a signal.
 */

/** Lights the firmware toggles (zc_lights has no set-to-state methods except high beams). */
export type ToggleLight = "turn_left" | "turn_right" | "hazard" | "drl" | "high_beam" | "tail" | "brake" | "reverse";

export type Command =
    | { type: "lights.toggle"; light: ToggleLight }
    /** Plays the welcome animation. */
    | { type: "lights.welcome" }
    | { type: "lights.setWelcomeColor"; rgb: [number, number, number] }
    /** Global LED brightness 0-255, all strips. The ECU does not echo it. */
    | { type: "lights.setBrightness"; value: number }
    /** Relay index as the firmware counts: 0 = relay 1, 1 = relay 2. */
    | { type: "motor.toggleRelay"; relay: 0 | 1 };

export type CommandType = Command["type"];

export type CommandResult = { ok: true } | { ok: false; error: string };
