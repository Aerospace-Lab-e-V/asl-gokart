import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
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
import { fetchReleases } from './github-releases';
import { downloadFirmware, getCachedVersions, getFirmwareLocalUrl, isDownloaded } from './firmware-manager';
import { getBindAddress } from '@/helpers/ipc/hardware/network-config';
import { FIRMWARE_SERVER_PORT } from '@/data/config';
import { EcuId } from '@/data/ecu/ecu-types';
import { ECU_DEFINITIONS } from '@/data/ecu/ecu-definitions';
import { sendOtaTrigger } from '@/helpers/ipc/sero/sero-service';
import { getEcuStatus, onEcuPresenceChange } from './ecu-presence';
import { getFlashHistory } from './firmware-history';
import { cancelOta, getOtaProgress, onOtaProgress, startOtaTracker, trackOta } from './ota-tracker';

export function registerFirmwareListeners(mainWindow: BrowserWindow): void {
    ipcMain.handle(FIRMWARE_GET_RELEASES_CHANNEL, async (_event, assetName: string) => {
        return fetchReleases(assetName);
    });

    ipcMain.handle(FIRMWARE_DOWNLOAD_CHANNEL, async (_event, ecuId: EcuId, tag: string, downloadUrl: string) => {
        if (isDownloaded(ecuId, tag)) {
            log.info(`[firmware] ${ecuId} ${tag} already cached, skipping download`);
            return { localUrl: getFirmwareLocalUrl(ecuId, tag) };
        }
        await downloadFirmware(ecuId, tag, downloadUrl);
        return { localUrl: getFirmwareLocalUrl(ecuId, tag) };
    });

    ipcMain.handle(FIRMWARE_TRIGGER_OTA_CHANNEL, async (_event, ecuId: EcuId, tag: string) => {
        const url = getFirmwareLocalUrl(ecuId, tag);

        if (!isDownloaded(ecuId, tag)) {
            throw new Error(`Firmware ${ecuId} ${tag} is not downloaded. Download it first.`);
        }

        const ecuDef = ECU_DEFINITIONS.find(d => d.id === ecuId);
        if (!ecuDef) {
            throw new Error(`Unknown ECU id: ${ecuId}`);
        }

        if (!getEcuStatus()[ecuId].online) {
            throw new Error(`${ecuDef.displayName} is offline.`);
        }

        // Follow the flash from here on; progress arrives on FIRMWARE_OTA_PROGRESS_CHANNEL.
        trackOta(ecuId, tag);
        try {
            await sendOtaTrigger(ecuDef.seroServiceId, url);
        } catch (err) {
            cancelOta(ecuId);
            throw err;
        }

        return { success: true, url };
    });

    ipcMain.handle(FIRMWARE_GET_SERVER_URL_CHANNEL, async () => {
        const bindAddress = getBindAddress();
        return `http://${bindAddress}:${FIRMWARE_SERVER_PORT}`;
    });

    ipcMain.handle(FIRMWARE_GET_CACHED_VERSIONS_CHANNEL, async () => {
        return getCachedVersions();
    });

    ipcMain.handle(FIRMWARE_GET_ECU_STATUS_CHANNEL, async () => {
        return getEcuStatus();
    });

    ipcMain.handle(FIRMWARE_GET_FLASH_HISTORY_CHANNEL, async () => {
        return getFlashHistory();
    });

    ipcMain.handle(FIRMWARE_GET_OTA_PROGRESS_CHANNEL, async (_event, ecuId: EcuId) => {
        return getOtaProgress(ecuId);
    });

    onEcuPresenceChange(() => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(FIRMWARE_ECU_STATUS_CHANNEL, getEcuStatus());
    });

    startOtaTracker();
    onOtaProgress((progress) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(FIRMWARE_OTA_PROGRESS_CHANNEL, progress);
    });
}
