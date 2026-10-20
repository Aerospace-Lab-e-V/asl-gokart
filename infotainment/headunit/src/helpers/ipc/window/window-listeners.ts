import { BrowserWindow, ipcMain } from "electron";
import { CH } from "@/ipc/channels";

export function addWindowEventListeners(mainWindow: BrowserWindow) {
    ipcMain.handle(CH.window.minimize, () => {
        mainWindow.minimize();
    });
    ipcMain.handle(CH.window.maximize, () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });
    ipcMain.handle(CH.window.close, () => {
        mainWindow.close();
    });
}
