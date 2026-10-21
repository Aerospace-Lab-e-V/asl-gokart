import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import crypto from "crypto";
import log from "electron-log/main";
import { CH } from "@/ipc/channels";
import { getAdminPinHash } from "@/helpers/ipc/application/system-config";

/*
 * Admin mode lives in main, so privileged IPC is refused no matter what the renderer does.
 * Locked at every start; the PIN is checked against a sha256 hash from the system config.
 */

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 30_000;

let admin = false;
let failures = 0;
let lockedUntil = 0;
const listeners = new Set<(admin: boolean) => void>();

function setAdmin(value: boolean): void {
    if (admin === value) return;
    admin = value;
    log.info(`[admin] Admin mode ${value ? "unlocked" : "locked"}`);
    listeners.forEach((l) => l(value));
}

export const isAdmin = (): boolean => admin;

/** False for a wrong PIN, and for any PIN while locked out after MAX_FAILURES wrong ones. */
export function unlock(pin: unknown): boolean {
    if (Date.now() < lockedUntil) {
        log.warn("[admin] Unlock refused: too many wrong PINs");
        return false;
    }
    const expected = Buffer.from(getAdminPinHash(), "hex");
    const actual = crypto.createHash("sha256").update(String(pin)).digest();
    if (typeof pin === "string" && expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
        failures = 0;
        setAdmin(true);
        return true;
    }
    if (++failures >= MAX_FAILURES) {
        failures = 0;
        lockedUntil = Date.now() + LOCKOUT_MS;
        log.warn(`[admin] ${MAX_FAILURES} wrong PINs, refusing unlock for ${LOCKOUT_MS / 1000} s`);
    }
    return false;
}

export const lock = (): void => setAdmin(false);

/** Returns a function that removes the listener. */
export function onAdminChange(listener: (admin: boolean) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Wraps an `ipcMain.handle` handler so it only runs in admin mode. */
export function requireAdmin<A extends unknown[], R>(
    handler: (event: IpcMainInvokeEvent, ...args: A) => R
): (event: IpcMainInvokeEvent, ...args: A) => R {
    return (event, ...args) => {
        if (!admin) throw new Error("Admin mode required");
        return handler(event, ...args);
    };
}

export function registerAdminListeners(mainWindow: BrowserWindow): void {
    ipcMain.handle(CH.admin.unlock, (_event, pin: unknown) => unlock(pin));
    ipcMain.handle(CH.admin.lock, () => lock());
    ipcMain.handle(CH.admin.get, () => admin);
    onAdminChange((value) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.admin.state, value);
    });
}
