import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { addThemeEventListeners } from "./theme/theme-listeners";
import { addWindowEventListeners } from "./window/window-listeners";
import { WEBSOCKET_SEND_CHANNEL } from "./websocket/ws-channels";
import { connected_zonecontrollers, startWebSocketServer } from "./websocket/ws-server";
import { OutgoingPacket } from "@/data/zonecontrollers/packets";
import { Zones } from "@/data/zonecontrollers/zonecontrollers";
import { addAppEventListeners } from "./application/app-listeners";
import { registerSeroHandlers, startSeroService } from "./sero/sero-service";
import { registerHardwareListeners } from "./hardware/hardware-listeners";
import { registerFirmwareListeners } from "./firmware/firmware-listeners";
import { startFirmwareServer } from "./firmware/firmware-server";
import { registerUpdaterListeners } from "./updater/updater-listeners";
import { waitForCarNetwork } from "./network-gate";

export default function registerListeners(mainWindow: BrowserWindow) {
    addWindowEventListeners(mainWindow);
    addThemeEventListeners();
    registerSeroHandlers();
    addAppEventListeners(mainWindow);
    registerHardwareListeners();
    registerFirmwareListeners(mainWindow);
    registerUpdaterListeners(mainWindow);

    // ponytail: Defer network-bound services until car network interface is available
    waitForCarNetwork(mainWindow).then(() => {
        log.info("[listeners-register] Car network ready, starting network services...");
        startWebSocketServer(mainWindow);
        startSeroService(mainWindow);
        startFirmwareServer();
    });

    ipcMain.on(WEBSOCKET_SEND_CHANNEL, (event, message: OutgoingPacket, zoneToSendTo: Zones) => {
        // Send the message to the zone controller matching the specified zone
        if (connected_zonecontrollers.size > 0) {
            connected_zonecontrollers.forEach((zc, z: Zones) => {
                if (z === zoneToSendTo) {
                    if (zc.webSocket && zc.webSocket.readyState === 1) {  // Ready state 1 means OPEN
                        zc.webSocket.send(JSON.stringify(message));
                        log.info(`[WEBSOCKET_SEND_CHANNEL] Sent message to [${z}] zone controller: ${JSON.stringify(message)}`);
                    } else {
                        log.error(`[WEBSOCKET_SEND_CHANNEL] Couldn't send message to [${z}] zone controller: WebSocket is not open!`);
                        // Remove the zone controller from the map
                        connected_zonecontrollers.delete(z);
                        log.info(`[WEBSOCKET_SEND_CHANNEL] Removed zone controller from connected_zonecontrollers: ${z}`);
                    }
                }
            });
        }
    });
}
