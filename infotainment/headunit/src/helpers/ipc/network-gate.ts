import { BrowserWindow, ipcMain } from "electron";
import os from "os";
import log from "electron-log/main";
import { getStoredMac, resolveInterfaceByMac } from "./hardware/network-config";

/** One OS network interface as the gate's engineer info shows it. */
export interface GateInterface {
    name: string;
    mac: string;
    /** Null when the interface has no IPv4 address, e.g. cable unplugged or no DHCP lease. */
    ipv4: string | null;
}

export interface NetworkGateStatus {
    ready: boolean;
    /** MAC of the car network interface the gate waits for. */
    mac: string | null;
    /** Epoch ms when the gate started waiting. */
    waitingSince: number;
    /** Epoch ms of the last interface check, null before the first one. */
    lastCheck: number | null;
    /** Interfaces seen at the last check. */
    interfaces: GateInterface[];
}

const CHECK_INTERVAL_MS = 2000;

let status: NetworkGateStatus = {
    ready: false,
    mac: null,
    waitingSince: Date.now(),
    lastCheck: null,
    interfaces: [],
};
let checkInterval: ReturnType<typeof setInterval> | null = null;
let resolveGate: (() => void) | null = null;
let gateWindow: BrowserWindow | null = null;

function listInterfaces(): GateInterface[] {
    return Object.entries(os.networkInterfaces()).flatMap(([name, infos]) => {
        const external = (infos ?? []).filter((info) => !info.internal);
        if (external.length === 0) return [];
        const ipv4 = external.find((info) => info.family === "IPv4");
        return [{ name, mac: external[0].mac, ipv4: ipv4?.address ?? null }];
    });
}

function publish(patch: Partial<NetworkGateStatus>) {
    status = { ...status, ...patch };
    if (gateWindow && !gateWindow.isDestroyed()) {
        gateWindow.webContents.send("network-gate:status", status);
    }
}

function openGate() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
    publish({ ready: true });
    resolveGate?.();
    resolveGate = null;
}

export function waitForCarNetwork(mainWindow: BrowserWindow): Promise<void> {
    gateWindow = mainWindow;
    return new Promise((resolve) => {
        resolveGate = resolve;
        const mac = getStoredMac();
        if (!mac) {
            // No MAC means a bench setup: there is no car network to wait for.
            log.info("[network-gate] No car network interface configured. Skipping gate.");
            openGate();
            return;
        }

        status = { ...status, mac, waitingSince: Date.now() };

        const check = () => {
            const resolved = resolveInterfaceByMac(mac);
            if (resolved) {
                log.info(
                    `[network-gate] Car network interface found on ${resolved.name} (${resolved.address}). Ready.`
                );
                openGate();
                return;
            }
            log.info(`[network-gate] Waiting for car network interface with MAC: ${mac}...`);
            publish({ lastCheck: Date.now(), interfaces: listInterfaces() });
        };

        check();
        // ponytail: Keep it simple, just poll os.networkInterfaces() periodically
        if (!status.ready) checkInterval = setInterval(check, CHECK_INTERVAL_MS);
    });
}

// Register IPC handler so renderer can ask for the status on mount
ipcMain.handle("network-gate:get-status", () => {
    return status;
});

// Manual override from the gate's engineer info; never triggered automatically
ipcMain.handle("network-gate:skip", () => {
    if (status.ready) return;
    log.info("[network-gate] Skip/override requested by user.");
    openGate();
});
