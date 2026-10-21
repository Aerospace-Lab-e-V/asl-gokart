import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { CH } from "@/ipc/channels";
import { requireAdmin } from "@/main/admin";
import { getAutoStart, setAutoStart, getFullscreenOnStartup, setFullscreenOnStartup, getDevToolsEnabled, setDevToolsEnabled } from "./system-config";
import type { LogLevel } from "@/lib/logger";

export function addAppEventListeners(mainWindow?: BrowserWindow) {
    ipcMain.handle(CH.app.getAutoStart, async () => {
        return getAutoStart();
    });
    ipcMain.handle(CH.app.setAutoStart, requireAdmin(async (_, enabled: boolean) => {
        return setAutoStart(enabled);
    }));
    ipcMain.handle(CH.app.getFullscreenOnStartup, async () => {
        return getFullscreenOnStartup();
    });
    ipcMain.handle(CH.app.setFullscreenOnStartup, requireAdmin(async (_, enabled: boolean) => {
        const result = setFullscreenOnStartup(enabled);
        if (mainWindow) {
            mainWindow.setFullScreen(enabled);
        }
        return result;
    }));
    ipcMain.handle(CH.app.getDevTools, async () => {
        return getDevToolsEnabled();
    });
    ipcMain.handle(CH.app.setDevTools, requireAdmin(async (_, enabled: boolean) => {
        const result = setDevToolsEnabled(enabled);
        // DevTools are only available in windows created while the setting was on (main.ts),
        // so turning it on takes effect at the next start.
        if (mainWindow) {
            if (enabled) {
                mainWindow.webContents.openDevTools();
            } else {
                mainWindow.webContents.closeDevTools();
            }
        }
        return result;
    }));
    ipcMain.handle(CH.app.version, async () => {
        return await app.getVersion();
    });
    ipcMain.handle(CH.app.setLogLevel, requireAdmin(async (_, level: LogLevel) => {
        log.transports.console.level = level;
        log.transports.file.level = level;
        log.info(`Log level changed to: ${level}`);
        return level;
    }));
    ipcMain.handle(CH.app.getLogLevel, async () => {
        return (log.transports.console.level as string) ?? "info";
    });
}
