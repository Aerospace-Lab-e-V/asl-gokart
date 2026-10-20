import { BrowserWindow, ipcMain } from "electron";
import { SERO_SEND_LIGHTS_CHANNEL, SERO_SEND_MOTOR_CHANNEL } from "./sero-channels";
import { LightsCommands, MotorCommands } from "@/data/zonecontrollers/zonecontrollers";
import type { Command, ToggleLight } from "@/domain/commands";
import { execute } from "@/main/command-bus";
import { startSeroAdapter } from "@/main/adapters/sero";

/*
 * Legacy shim: the Sero logic lives in `@/main/adapters/sero` and `@/main/command-bus`. Kept only so the old
 * importers (main.ts, listeners-register.ts, hardware/firmware listeners) and the old `window.sero` command
 * channels keep working until integration rewires them; then delete this folder.
 * The old `sero-*-message` telemetry channels are no longer sent: telemetry goes over `signals:batch`.
 */

export { stopSeroAdapter as stopSeroService, restartSeroAdapter as restartSeroService, sendOtaTrigger } from "@/main/adapters/sero";

/** The window is no longer needed: the adapter publishes to the signal hub (B5). */
export function startSeroService(_mainWindow?: BrowserWindow): void {
    startSeroAdapter();
}

const LEGACY_TOGGLE: Partial<Record<LightsCommands, ToggleLight>> = {
    [LightsCommands.SET_TOGGLE_TURN_SIGNAL_LEFT]: "turn_left",
    [LightsCommands.SET_TOGGLE_TURN_SIGNAL_RIGHT]: "turn_right",
    [LightsCommands.SET_TOGGLE_HAZARD_LIGHTS]: "hazard",
    [LightsCommands.SET_TOGGLE_HEADLIGHTS]: "drl",
    [LightsCommands.SET_TOGGLE_DRL]: "drl",
    [LightsCommands.SET_TOGGLE_HIGH_BEAMS]: "high_beam",
    [LightsCommands.SET_TOGGLE_BRAKE]: "brake",
    [LightsCommands.SET_TOGGLE_REVERSE]: "reverse",
    [LightsCommands.SET_TOGGLE_TAIL_LIGHT]: "tail",
};

function legacyLightsCommand(command: LightsCommands, value: unknown): Command | null {
    const light = LEGACY_TOGGLE[command];
    if (light) return { type: "lights.toggle", light };
    switch (command) {
        case LightsCommands.TRIGGER_WELCOME_LIGHT:
            return { type: "lights.welcome" };
        case LightsCommands.SET_WELCOME_LIGHT_COLOR:
            return { type: "lights.setWelcomeColor", rgb: value as [number, number, number] };
        case LightsCommands.SET_BRIGHTNESS:
            // Old payload: [strip, value]; the command bus always targets all strips.
            return { type: "lights.setBrightness", value: Array.isArray(value) ? value[1] : value };
        default:
            return null;
    }
}

/** Old `window.sero.send*Command` channels, routed through the command bus. Integration deletes them. */
export function registerSeroHandlers(): void {
    ipcMain.on(SERO_SEND_LIGHTS_CHANNEL, (_, args) => {
        const command = legacyLightsCommand(args?.command, args?.value);
        if (command) void execute(command);
    });

    ipcMain.handle(SERO_SEND_MOTOR_CHANNEL, async (_, args) => {
        if (args?.command !== MotorCommands.TOGGLE_RELAY) return false;
        return (await execute({ type: "motor.toggleRelay", relay: args.value })).ok;
    });
}
