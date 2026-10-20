import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import os from "os";
import { CH } from "@/ipc/channels";
import { requireAdmin } from "@/main/admin";
import { setStoredMac, getCurrentInterface, resolveInterfaceByMac } from "./network-config";
import { restartSeroAdapter } from "@/main/adapters/sero";
import { restartFirmwareServer } from "@/helpers/ipc/firmware/firmware-server";

const CONNECTION_POLL_MS = 5000;

/** The car network counts as connected when the stored interface currently has an IPv4 address. */
const isConnected = () => getCurrentInterface() !== null;

/** Pass the window to get CH.hardware.connection pushes when the connection changes. */
export function registerHardwareListeners(mainWindow?: BrowserWindow) {
    let connected = isConnected();
    const checkConnection = () => {
        const now = isConnected();
        if (now === connected) return;
        connected = now;
        log.info(`[hardware] Car network ${now ? "connected" : "disconnected"}`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(CH.hardware.connection, now);
    };
    // ponytail: polls os.networkInterfaces(); switch to netlink events if 5 s latency ever matters.
    setInterval(checkConnection, CONNECTION_POLL_MS);

    ipcMain.handle(CH.hardware.getConnection, () => isConnected());
    ipcMain.handle(CH.hardware.getAvailableNetworkInterfaces, async () => {
        const interfaces = os.networkInterfaces();
        log.debug("Retrieved network interfaces:", interfaces);
        return interfaces;
    });
    ipcMain.handle(CH.hardware.getNetworkInterface, async () => {
        const current = getCurrentInterface();
        log.debug("Current network interface:", current);
        return current;
    });
    ipcMain.handle(CH.hardware.setNetworkInterface, requireAdmin(async (_event, mac: string) => {
        log.info(`[hardware] Setting network interface to MAC: ${mac}`);

        const resolved = resolveInterfaceByMac(mac);
        if (!resolved) {
            log.error(`[hardware] MAC ${mac} not found among current interfaces`);
            throw new Error(`Interface with MAC ${mac} not found`);
        }

        setStoredMac(mac);
        log.info(`[hardware] Stored MAC ${mac}, restarting services on ${resolved.address}...`);

        await restartSeroAdapter();
        await restartFirmwareServer();
        checkConnection();

        log.info(`[hardware] Services restarted on interface ${resolved.name} (${resolved.address})`);
        return getCurrentInterface();
    }));
}
