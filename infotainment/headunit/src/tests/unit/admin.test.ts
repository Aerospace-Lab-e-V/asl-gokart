jest.mock("electron", () => {
    const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "headunit-admin-"));
    return { app: { getPath: () => dir }, ipcMain: { handle: jest.fn() } };
});
jest.mock("electron-log/main", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import type { IpcMainInvokeEvent } from "electron";
import { isAdmin, lock, LOCKOUT_MS, MAX_FAILURES, onAdminChange, requireAdmin, unlock } from "@/main/admin";

const event = {} as IpcMainInvokeEvent;

afterEach(() => {
    lock();
    jest.useRealTimers();
});

test("locked at start; the default hash accepts the old PIN only", () => {
    expect(isAdmin()).toBe(false);
    expect(unlock("1234")).toBe(false);
    expect(unlock(69420)).toBe(false);
    expect(isAdmin()).toBe(false);
    expect(unlock("69420")).toBe(true);
    expect(isAdmin()).toBe(true);
});

test("requireAdmin refuses until unlocked and reports changes", async () => {
    const handler = requireAdmin(async (_e, x: number) => x * 2);
    expect(() => handler(event, 2)).toThrow("Admin mode required");

    const changes: boolean[] = [];
    const off = onAdminChange((v) => changes.push(v));
    unlock("69420");
    await expect(handler(event, 2)).resolves.toBe(4);
    lock();
    off();
    expect(changes).toEqual([true, false]);
});

test("too many wrong PINs lock out even the right one for a while", () => {
    jest.useFakeTimers({ now: 1_000_000 });
    for (let i = 0; i < MAX_FAILURES; i++) expect(unlock("0000")).toBe(false);
    expect(unlock("69420")).toBe(false);

    jest.setSystemTime(1_000_000 + LOCKOUT_MS);
    expect(unlock("69420")).toBe(true);
});
