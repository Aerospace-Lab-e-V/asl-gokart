import {
    FIRMWARE_GET_RELEASES_CHANNEL,
    FIRMWARE_DOWNLOAD_CHANNEL,
    FIRMWARE_TRIGGER_OTA_CHANNEL,
    FIRMWARE_GET_SERVER_URL_CHANNEL,
    FIRMWARE_GET_CACHED_VERSIONS_CHANNEL,
    FIRMWARE_GET_ECU_STATUS_CHANNEL,
    FIRMWARE_ECU_STATUS_CHANNEL,
    FIRMWARE_GET_FLASH_HISTORY_CHANNEL,
    FIRMWARE_GET_OTA_PROGRESS_CHANNEL,
    FIRMWARE_OTA_PROGRESS_CHANNEL,
} from './firmware-channels';

export function exposeFirmwareContext(): void {
    const { contextBridge, ipcRenderer } = window.require('electron');

    contextBridge.exposeInMainWorld('firmware', {
        getReleases: async (assetName: string) => {
            return ipcRenderer.invoke(FIRMWARE_GET_RELEASES_CHANNEL, assetName);
        },
        downloadFirmware: async (ecuId: string, tag: string, downloadUrl: string) => {
            return ipcRenderer.invoke(FIRMWARE_DOWNLOAD_CHANNEL, ecuId, tag, downloadUrl);
        },
        triggerOta: async (ecuId: string, tag: string) => {
            return ipcRenderer.invoke(FIRMWARE_TRIGGER_OTA_CHANNEL, ecuId, tag);
        },
        getServerBaseUrl: async () => {
            return ipcRenderer.invoke(FIRMWARE_GET_SERVER_URL_CHANNEL);
        },
        getCachedVersions: async () => {
            return ipcRenderer.invoke(FIRMWARE_GET_CACHED_VERSIONS_CHANNEL);
        },
        getEcuStatus: async () => {
            return ipcRenderer.invoke(FIRMWARE_GET_ECU_STATUS_CHANNEL);
        },
        getFlashHistory: async () => {
            return ipcRenderer.invoke(FIRMWARE_GET_FLASH_HISTORY_CHANNEL);
        },
        onEcuStatus: (callback: (status: unknown) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
            ipcRenderer.on(FIRMWARE_ECU_STATUS_CHANNEL, listener);
            return () => ipcRenderer.removeListener(FIRMWARE_ECU_STATUS_CHANNEL, listener);
        },
        getOtaProgress: async (ecuId: string) => {
            return ipcRenderer.invoke(FIRMWARE_GET_OTA_PROGRESS_CHANNEL, ecuId);
        },
        onOtaProgress: (callback: (progress: unknown) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
            ipcRenderer.on(FIRMWARE_OTA_PROGRESS_CHANNEL, listener);
            return () => ipcRenderer.removeListener(FIRMWARE_OTA_PROGRESS_CHANNEL, listener);
        },
    });
}
