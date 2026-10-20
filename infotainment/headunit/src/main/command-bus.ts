import log from "electron-log/main";
import type { Command, CommandResult, ToggleLight } from "@/domain/commands";
import { METHOD, SERVICE, fireAndForget, request } from "@/main/adapters/sero";

/*
 * Routes a Command from the renderer to the adapter that owns the ECU. Commands arrive over IPC, so their shape
 * is checked here before anything is sent. Success means the ECU took it, not that state changed: that comes
 * back as a signal.
 */

const TOGGLE_METHOD: Record<ToggleLight, number> = {
    turn_left: METHOD.lights.TURN_LEFT,
    turn_right: METHOD.lights.TURN_RIGHT,
    hazard: METHOD.lights.HAZARD,
    high_beam: METHOD.lights.HIGH_BEAM,
    brake: METHOD.lights.BRAKE,
    reverse: METHOD.lights.REVERSE,
    drl: METHOD.lights.DRL,
    tail: METHOD.lights.TAIL,
};

/** All strips, for the brightness method. */
const ALL_STRIPS = 0xff;

const isByte = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;

const fail = (error: string): CommandResult => ({ ok: false, error });

const sent = (ok: boolean): CommandResult => (ok ? { ok: true } : fail("Sero could not send the command"));

async function route(c: Record<string, unknown>): Promise<CommandResult> {
    switch (c.type) {
        case "lights.toggle": {
            const method = Object.hasOwn(TOGGLE_METHOD, c.light as string) ? TOGGLE_METHOD[c.light as ToggleLight] : undefined;
            if (method === undefined) return fail(`unknown light: ${String(c.light)}`);
            return sent(fireAndForget(SERVICE.LIGHTS, method));
        }
        case "lights.welcome":
            return sent(fireAndForget(SERVICE.LIGHTS, METHOD.lights.WELCOME));
        case "lights.setWelcomeColor": {
            const rgb = c.rgb;
            if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(isByte)) return fail("rgb must be three integers 0-255");
            return sent(fireAndForget(SERVICE.LIGHTS, METHOD.lights.WELCOME_COLOR, rgb));
        }
        case "lights.setBrightness":
            if (!isByte(c.value)) return fail("brightness must be an integer 0-255");
            return sent(fireAndForget(SERVICE.LIGHTS, METHOD.lights.BRIGHTNESS, [ALL_STRIPS, c.value]));
        case "motor.toggleRelay": {
            if (c.relay !== 0 && c.relay !== 1) return fail("relay must be 0 or 1");
            const result = await request(SERVICE.MOTOR, METHOD.motor.TOGGLE_RELAY, [c.relay]);
            return result.returnCode === 0 /* E_OK */ ? { ok: true } : fail(`ECU rejected it (returnCode=${result.returnCode})`);
        }
        default:
            return fail(`unknown command: ${String(c.type)}`);
    }
}

/** Never throws: every failure, including a runtime that is not started, is an `{ ok: false }` result. */
export async function execute(command: Command): Promise<CommandResult> {
    if (typeof command !== "object" || command === null) return fail("command must be an object");
    try {
        const result = await route(command as unknown as Record<string, unknown>);
        if (!result.ok) log.warn(`[command] ${String(command.type)} failed: ${result.error}`);
        return result;
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.error(`[command] ${String(command.type)} failed:`, error);
        return fail(error);
    }
}
