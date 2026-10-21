import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { addThemeEventListeners } from "./theme/theme-listeners";
import { addWindowEventListeners } from "./window/window-listeners";
import { addAppEventListeners } from "./application/app-listeners";
import { registerHardwareListeners } from "./hardware/hardware-listeners";
import { registerFirmwareListeners } from "./firmware/firmware-listeners";
import { startFirmwareServer } from "./firmware/firmware-server";
import { registerUpdaterListeners } from "./updater/updater-listeners";
import { registerNetworkGateListeners, waitForCarNetwork } from "./network-gate";
import { registerAdminListeners } from "@/main/admin";
import { registerKartAgentListeners } from "@/main/kart-agent";
import { registerSignalIpc } from "@/main/signal-ipc";
import { startSeroAdapter } from "@/main/adapters/sero";

export default function registerListeners(mainWindow: BrowserWindow) {
    registerAdminListeners(mainWindow);
    addWindowEventListeners(mainWindow);
    addThemeEventListeners();
    addAppEventListeners(mainWindow);
    registerNetworkGateListeners();
    registerHardwareListeners(mainWindow);
    registerFirmwareListeners(mainWindow);
    registerUpdaterListeners(mainWindow);
    registerKartAgentListeners(mainWindow);
    registerSignalIpc(mainWindow);

    // ponytail: Defer network-bound services until car network interface is available
    waitForCarNetwork(mainWindow).then(() => {
        log.info("[listeners-register] Car network ready, starting network services...");
        startSeroAdapter();
        startFirmwareServer();
    });
}
