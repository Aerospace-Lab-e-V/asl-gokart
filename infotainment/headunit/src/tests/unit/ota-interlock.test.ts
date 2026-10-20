import fs from "fs";
import path from "path";

const mockHandlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {};

jest.mock("electron", () => {
    const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "headunit-ota-"));
    return {
        app: { getPath: () => dir },
        ipcMain: { handle: (channel: string, fn: never) => (mockHandlers[channel] = fn) },
    };
});
jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("@/main/adapters/sero", () => ({ sendOtaTrigger: jest.fn(() => Promise.resolve()) }));
jest.mock("@/helpers/ipc/firmware/ota-tracker", () => ({
    trackOta: jest.fn(),
    cancelOta: jest.fn(),
    getOtaProgress: jest.fn(),
    onOtaProgress: jest.fn(),
    startOtaTracker: jest.fn(),
}));

import type { BrowserWindow } from "electron";
import { CH } from "@/ipc/channels";
import { registerFirmwareListeners } from "@/helpers/ipc/firmware/firmware-listeners";
import { getFirmwarePath } from "@/helpers/ipc/firmware/firmware-manager";
import { markServiceFound } from "@/helpers/ipc/firmware/ecu-presence";
import { markEcuLost, publish, resetSignalHub } from "@/main/signal-hub";
import { sendOtaTrigger } from "@/main/adapters/sero";
import { unlock } from "@/main/admin";

const win = { isDestroyed: () => false, webContents: { send: jest.fn() } } as unknown as BrowserWindow;
registerFirmwareListeners(win);
const triggerOta = (ecuId: string, tag: string) => Promise.resolve().then(() => mockHandlers[CH.firmware.triggerOta]({}, ecuId, tag));

afterAll(resetSignalHub);

test("OTA needs admin and a fresh standstill speed", async () => {
    const file = getFirmwarePath("zc_lights", "v1.0.0");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "fw");
    markServiceFound(0x0001, "10.0.0.2");

    await expect(triggerOta("zc_lights", "v1.0.0")).rejects.toThrow("Admin mode required");
    unlock("69420");

    await expect(triggerOta("zc_lights", "v1.0.0")).rejects.toThrow("No fresh speed");

    publish("drive.speed", 12);
    await expect(triggerOta("zc_lights", "v1.0.0")).rejects.toThrow("moving");

    publish("drive.speed", 0);
    markEcuLost("zc_motor");
    await expect(triggerOta("zc_lights", "v1.0.0")).rejects.toThrow("No fresh speed");
    expect(sendOtaTrigger).not.toHaveBeenCalled();

    publish("drive.speed", 0);
    await expect(triggerOta("zc_lights", "v1.0.0")).resolves.toMatchObject({ success: true });
    expect(sendOtaTrigger).toHaveBeenCalledWith(0x0001, expect.stringContaining("/firmware/zc_lights/v1.0.0/fw.bin"));
});
