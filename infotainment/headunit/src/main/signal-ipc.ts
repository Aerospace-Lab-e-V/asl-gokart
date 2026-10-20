import { BrowserWindow, ipcMain } from "electron";
import { CH } from "@/ipc/channels";
import { onBatch, snapshot, startSignalHub } from "@/main/signal-hub";
import { execute } from "@/main/command-bus";

/*
 * The only main module that knows the window for telemetry: forwards signal batches to it and answers
 * snapshot and command invokes. Adapters publish to the hub and never see the window (B5).
 */

let removeBatchListener: (() => void) | null = null;

/** Idempotent: a second call (e.g. a recreated window) replaces the previous registration. */
export function registerSignalIpc(win: BrowserWindow): void {
    unregisterSignalIpc();
    ipcMain.handle(CH.signals.snapshot, () => snapshot());
    ipcMain.handle(CH.command, (_e, command) => execute(command));
    removeBatchListener = onBatch((batch) => {
        if (!win.isDestroyed()) win.webContents.send(CH.signals.batch, batch);
    });
    startSignalHub();
}

export function unregisterSignalIpc(): void {
    ipcMain.removeHandler(CH.signals.snapshot);
    ipcMain.removeHandler(CH.command);
    removeBatchListener?.();
    removeBatchListener = null;
}
