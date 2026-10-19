import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { 
    APP_VERSION_CHANNEL, 
    APP_SET_LOG_LEVEL_CHANNEL, 
    APP_GET_LOG_LEVEL_CHANNEL, 
    APP_GET_AUTO_START_CHANNEL,
    APP_SET_AUTO_START_CHANNEL,
    APP_GET_FULLSCREEN_STARTUP_CHANNEL,
    APP_SET_FULLSCREEN_STARTUP_CHANNEL,
    APP_GET_DEV_TOOLS_CHANNEL,
    APP_SET_DEV_TOOLS_CHANNEL
} from "./app-channels";
import { getAutoStart, setAutoStart, getFullscreenOnStartup, setFullscreenOnStartup, getDevToolsEnabled, setDevToolsEnabled } from "./system-config";
import type { LogLevel } from "@/lib/logger";

export function addAppEventListeners(mainWindow?: BrowserWindow) {
    ipcMain.handle(APP_GET_AUTO_START_CHANNEL, async () => {
        return getAutoStart();
    });
    ipcMain.handle(APP_SET_AUTO_START_CHANNEL, async (_, enabled: boolean) => {
        return setAutoStart(enabled);
    });
    ipcMain.handle(APP_GET_FULLSCREEN_STARTUP_CHANNEL, async () => {
        return getFullscreenOnStartup();
    });
    ipcMain.handle(APP_SET_FULLSCREEN_STARTUP_CHANNEL, async (_, enabled: boolean) => {
        const result = setFullscreenOnStartup(enabled);
        if (mainWindow) {
            mainWindow.setFullScreen(enabled);
        }
        return result;
    });
    ipcMain.handle(APP_GET_DEV_TOOLS_CHANNEL, async () => {
        return getDevToolsEnabled();
    });
    ipcMain.handle(APP_SET_DEV_TOOLS_CHANNEL, async (_, enabled: boolean) => {
        const result = setDevToolsEnabled(enabled);
        if (mainWindow) {
            if (enabled) {
                mainWindow.webContents.openDevTools();
            } else {
                mainWindow.webContents.closeDevTools();
            }
        }
        return result;
    });
    ipcMain.handle(APP_VERSION_CHANNEL, async () => {
        return await app.getVersion();
    });
    ipcMain.handle(APP_SET_LOG_LEVEL_CHANNEL, async (_, level: LogLevel) => {
        log.transports.console.level = level;
        log.transports.file.level = level;
        log.info(`Log level changed to: ${level}`);
        return level;
    });
    ipcMain.handle(APP_GET_LOG_LEVEL_CHANNEL, async () => {
        return (log.transports.console.level as string) ?? "info";
    });
}