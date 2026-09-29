import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import fs from "fs";
import {
    TINYBUF_ADC_STATUS_CHANNEL,
    TINYBUF_SEND_LED_CHANNEL,
    TINYBUF_GET_STATUS_CHANNEL,
} from "./tinybuf-channels";
import { AdcStatusData, TinybufStatus } from "@/lib/types/ipc";
import { getTinybufConfigPath } from "./tinybuf-config";

export interface ITinybufProxy {
    open(configFile?: string): boolean;
    close(): void;
    isAvailable(): boolean;
    getRunLevel(): number;
    getStatus(): string;
    sendLedCommand(on: boolean): boolean;
    sendLedCommand(sequence: number, on: boolean): boolean;
    onAdcStatus(callback: (data: AdcStatusData) => void): void;
    clearAdcStatus(): void;
}

let proxy: ITinybufProxy | null = null;
let storedMainWindow: BrowserWindow | null = null;
let isStarted = false;

function loadBindings(): any {
    try {
        const mod = require("@asl-gokart/tinybuf-node");
        return mod.bindings || mod.default || mod;
    } catch (err) {
        log.warn(
            "[TINYBUF] Failed to require @asl-gokart/tinybuf-node, checking local fallback:",
            err
        );
        // TODO: Remove local binary fallback as @asl-gokart/tinybuf-node should be the source of truth for the native bindings
        const localBinary =
            "/home/leo/Documents/Programming/rustlet-rt/tinybuf-node/build/Release/tinybuf-node.node";
        if (fs.existsSync(localBinary)) {
            try {
                return require(localBinary);
            } catch (fallbackErr) {
                log.error("[TINYBUF] Local fallback also failed:", fallbackErr);
            }
        }
        return null;
    }
}

export function startTinybufService(mainWindow: BrowserWindow): boolean {
    storedMainWindow = mainWindow;
    if (isStarted && proxy) {
        log.info("[TINYBUF] Service already started");
        return true;
    }

    log.info("[TINYBUF] Starting Tinybuf service...");
    const bindings = loadBindings();
    if (!bindings || !bindings.TinybufProxy) {
        log.error("[TINYBUF] TinybufProxy not available in native bindings");
        return false;
    }

    try {
        const configPath = getTinybufConfigPath();
        log.info(`[TINYBUF] Initializing TinybufProxy with config: ${configPath}`);
        proxy = new bindings.TinybufProxy(configPath);
        if (!proxy) {
            log.error("[TINYBUF] Could not create TinybufProxy instance");
            return false;
        }

        const success = proxy.open(configPath);
        if (!success) {
            log.warn("[TINYBUF] TinybufProxy open returned false");
            return false;
        }

        // Register receive callback for ADC status
        proxy.onAdcStatus((data: AdcStatusData) => {
            log.debug(`[TINYBUF] ADC status received:`, data);
            if (storedMainWindow && !storedMainWindow.isDestroyed()) {
                storedMainWindow.webContents.send(TINYBUF_ADC_STATUS_CHANNEL, data);
            }
        });

        isStarted = true;
        log.info("[TINYBUF] Tinybuf service started successfully. Status:", proxy.getStatus());
        return true;
    } catch (err) {
        log.error("[TINYBUF] Error starting Tinybuf service:", err);
        isStarted = false;
        return false;
    }
}

export function stopTinybufService(): void {
    if (proxy) {
        try {
            log.info("[TINYBUF] Stopping Tinybuf service...");
            proxy.clearAdcStatus();
            proxy.close();
        } catch (err) {
            log.error("[TINYBUF] Error closing TinybufProxy:", err);
        } finally {
            proxy = null;
            isStarted = false;
        }
    }
}

export function restartTinybufService(): boolean {
    if (!storedMainWindow) {
        log.error("[TINYBUF] Cannot restart: main window not set");
        return false;
    }
    stopTinybufService();
    return startTinybufService(storedMainWindow);
}

export function sendLedCommand(on: boolean, sequence?: number): boolean {
    if (!proxy || !isStarted) {
        log.warn("[TINYBUF] Cannot send LED command: Tinybuf service is not running");
        return false;
    }
    try {
        log.info(
            `[TINYBUF] Sending LED command: on=${on}${sequence !== undefined ? `, sequence=${sequence}` : ""}`
        );
        if (typeof sequence === "number") {
            return proxy.sendLedCommand(sequence, on);
        } else {
            return proxy.sendLedCommand(on);
        }
    } catch (err) {
        log.error("[TINYBUF] Failed to send LED command:", err);
        return false;
    }
}

export function getTinybufStatus(): TinybufStatus {
    if (!proxy || !isStarted) {
        return { available: false, status: "Stopped", runLevel: 0 };
    }
    try {
        return {
            available: proxy.isAvailable(),
            status: proxy.getStatus(),
            runLevel: proxy.getRunLevel(),
        };
    } catch (err) {
        return { available: false, status: String(err), runLevel: 0 };
    }
}

export function registerTinybufHandlers(): void {
    ipcMain.handle(
        TINYBUF_SEND_LED_CHANNEL,
        async (_, args: { on: boolean; sequence?: number } | boolean) => {
            if (typeof args === "boolean") {
                return sendLedCommand(args);
            }
            return sendLedCommand(args?.on ?? false, args?.sequence);
        }
    );

    ipcMain.handle(TINYBUF_GET_STATUS_CHANNEL, async () => {
        return getTinybufStatus();
    });
}
