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

export function exposeAppContext() {
    const { contextBridge, ipcRenderer } = window.require('electron');

    contextBridge.exposeInMainWorld('app', {
        getVersion: async () => {
            return await ipcRenderer.invoke(APP_VERSION_CHANNEL);
        },
        setLogLevel: async (level: string): Promise<string> => {
            return await ipcRenderer.invoke(APP_SET_LOG_LEVEL_CHANNEL, level);
        },
        getLogLevel: async (): Promise<string> => {
            return await ipcRenderer.invoke(APP_GET_LOG_LEVEL_CHANNEL);
        },
        getAutoStart: async (): Promise<boolean> => {
            return await ipcRenderer.invoke(APP_GET_AUTO_START_CHANNEL);
        },
        setAutoStart: async (enabled: boolean): Promise<boolean> => {
            return await ipcRenderer.invoke(APP_SET_AUTO_START_CHANNEL, enabled);
        },
        getFullscreenOnStartup: async (): Promise<boolean> => {
            return await ipcRenderer.invoke(APP_GET_FULLSCREEN_STARTUP_CHANNEL);
        },
        setFullscreenOnStartup: async (enabled: boolean): Promise<boolean> => {
            return await ipcRenderer.invoke(APP_SET_FULLSCREEN_STARTUP_CHANNEL, enabled);
        },
        getDevToolsEnabled: async (): Promise<boolean> => {
            return await ipcRenderer.invoke(APP_GET_DEV_TOOLS_CHANNEL);
        },
        setDevToolsEnabled: async (enabled: boolean): Promise<boolean> => {
            return await ipcRenderer.invoke(APP_SET_DEV_TOOLS_CHANNEL, enabled);
        },
        isNetworkReady: async (): Promise<boolean> => {
            return await ipcRenderer.invoke("network-gate:get-status");
        },
        onNetworkStatusChange: (callback: (status: { ready: boolean }) => void) => {
            const listener = (_: unknown, status: { ready: boolean }) => callback(status);
            ipcRenderer.on("network-gate:status", listener);
            return () => ipcRenderer.removeListener("network-gate:status", listener);
        },
        skipNetworkGate: async (): Promise<void> => {
            return await ipcRenderer.invoke("network-gate:skip");
        },
    });
}