import { 
    GET_AVAILABLE_NETWORK_INTERFACES_CHANNEL,
    SET_NETWORK_INTERFACE_CHANNEL,
    GET_NETWORK_INTERFACE_CHANNEL,
} from "./hardware-channels";
import log from "@/lib/logger";
import { ipcMain } from "electron";
import os from "os";
import { setStoredMac, getCurrentInterface, resolveInterfaceByMac } from "./network-config";
import { restartSeroService } from "@/helpers/ipc/sero/sero-service";
import { restartFirmwareServer } from "@/helpers/ipc/firmware/firmware-server";

export function registerHardwareListeners() {
    ipcMain.handle(GET_AVAILABLE_NETWORK_INTERFACES_CHANNEL, async () => {
        const interfaces = os.networkInterfaces();
        log.debug("Retrieved network interfaces:", interfaces);
        return interfaces;
    });
    ipcMain.handle(GET_NETWORK_INTERFACE_CHANNEL, async () => {
        const current = getCurrentInterface();
        log.debug("Current network interface:", current);
        return current;
    });
    ipcMain.handle(SET_NETWORK_INTERFACE_CHANNEL, async (_event, mac: string) => {
        log.info(`[hardware] Setting network interface to MAC: ${mac}`);

        const resolved = resolveInterfaceByMac(mac);
        if (!resolved) {
            log.error(`[hardware] MAC ${mac} not found among current interfaces`);
            throw new Error(`Interface with MAC ${mac} not found`);
        }

        setStoredMac(mac);
        log.info(`[hardware] Stored MAC ${mac}, restarting services on ${resolved.address}...`);

        restartSeroService();
        await restartFirmwareServer();

        log.info(`[hardware] Services restarted on interface ${resolved.name} (${resolved.address})`);
        return getCurrentInterface();
    });
}