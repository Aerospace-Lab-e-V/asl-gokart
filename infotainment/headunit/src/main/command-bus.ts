import log from "electron-log/main";
import type { Command, CommandResult, SettableLight, ToggleLight } from "@/domain/commands";
import { findAnimation, type AnimationLayer } from "@/domain/lights";
import { METHOD, RC, SERVICE, fireAndForget, publishLightsConfig, request } from "@/main/adapters/sero";
import { assertWelcomeAllowed } from "@/main/standstill";

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

const SET_METHOD: Record<SettableLight, number> = {
    drl: METHOD.lights.DRL,
    high_beam: METHOD.lights.HIGH_BEAM,
    tail: METHOD.lights.TAIL,
    brake: METHOD.lights.BRAKE,
    reverse: METHOD.lights.REVERSE,
};

/** SET_WELCOME_CONFIG mask bits. */
const MASK = { enabled: 1, front: 2, rear: 4, ambient: 8 } as const;

const LAYER_BYTE: Record<AnimationLayer, number> = { front: 0, rear: 1 };

const isByte = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;

const fail = (error: string): CommandResult => ({ ok: false, error });

const sent = (ok: boolean): CommandResult => (ok ? { ok: true } : fail("Sero could not send the command"));

const rejected = (returnCode: number): CommandResult =>
    fail(
        returnCode === RC.E_UNKNOWN_METHOD
            ? "zc_lights firmware is too old for this"
            : returnCode === RC.E_TIMEOUT
              ? "zc_lights did not answer"
              : `ECU rejected it (returnCode=${returnCode})`
    );

/** Sends a settings method whose answer is the new config blob, and publishes that answer (the ECU's echo). */
async function lightsSetting(method: number, payload: number[]): Promise<CommandResult> {
    const result = await request(SERVICE.LIGHTS, method, payload);
    if (result.returnCode !== RC.E_OK) return rejected(result.returnCode);
    publishLightsConfig(result.payload);
    return { ok: true };
}

function setWelcomePayload(c: Record<string, unknown>): number[] | string {
    let mask = 0;
    const bytes = [0, 0, 0, 0];
    if (c.enabled !== undefined) {
        if (typeof c.enabled !== "boolean") return "enabled must be a boolean";
        mask |= MASK.enabled;
        bytes[0] = c.enabled ? 1 : 0;
    }
    if (c.front !== undefined) {
        if (!isByte(c.front) || !findAnimation("front", c.front)) return `unknown front animation: ${String(c.front)}`;
        mask |= MASK.front;
        bytes[1] = c.front;
    }
    if (c.rear !== undefined) {
        if (!isByte(c.rear) || !findAnimation("rear", c.rear)) return `unknown rear animation: ${String(c.rear)}`;
        mask |= MASK.rear;
        bytes[2] = c.rear;
    }
    if (c.ambient !== undefined) {
        if (!isByte(c.ambient)) return "ambient must be an integer 0-255";
        mask |= MASK.ambient;
        bytes[3] = c.ambient;
    }
    return mask ? [mask, ...bytes] : "nothing to set";
}

async function route(c: Record<string, unknown>): Promise<CommandResult> {
    switch (c.type) {
        case "lights.toggle": {
            const method = Object.hasOwn(TOGGLE_METHOD, c.light as string) ? TOGGLE_METHOD[c.light as ToggleLight] : undefined;
            if (method === undefined) return fail(`unknown light: ${String(c.light)}`);
            return sent(fireAndForget(SERVICE.LIGHTS, method));
        }
        case "lights.set": {
            const method = Object.hasOwn(SET_METHOD, c.light as string) ? SET_METHOD[c.light as SettableLight] : undefined;
            if (method === undefined) return fail(`unknown light: ${String(c.light)}`);
            if (typeof c.on !== "boolean") return fail("on must be a boolean");
            return sent(fireAndForget(SERVICE.LIGHTS, method, [c.on ? 1 : 0]));
        }
        case "lights.welcome": {
            assertWelcomeAllowed();
            const result = await request(SERVICE.LIGHTS, METHOD.lights.WELCOME, []);
            if (result.returnCode === RC.E_NOT_READY) return fail("zc_lights refused: brake, reverse or a turn signal is on, or the kart is moving");
            return result.returnCode === RC.E_OK ? { ok: true } : rejected(result.returnCode);
        }
        case "lights.setWelcome": {
            const payload = setWelcomePayload(c);
            if (typeof payload === "string") return fail(payload);
            return lightsSetting(METHOD.lights.SET_WELCOME_CONFIG, payload);
        }
        case "lights.setAnimationColor": {
            const layer = c.layer as AnimationLayer;
            if (layer !== "front" && layer !== "rear") return fail("layer must be front or rear");
            const anim = isByte(c.id) ? findAnimation(layer, c.id) : undefined;
            if (!anim) return fail(`unknown ${layer} animation: ${String(c.id)}`);
            if (!anim.customColor) return fail(`${anim.name} has a fixed colour`);
            const rgb = c.rgb;
            if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(isByte)) return fail("rgb must be three integers 0-255");
            return lightsSetting(METHOD.lights.SET_ANIM_COLOR, [LAYER_BYTE[layer], anim.id, ...rgb]);
        }
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
