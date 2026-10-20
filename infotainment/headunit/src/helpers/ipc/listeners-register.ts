import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { addThemeEventListeners } from "./theme/theme-listeners";
import { addWindowEventListeners } from "./window/window-listeners";
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
        startSeroService(mainWindow);
        startFirmwareServer();
    });
}
