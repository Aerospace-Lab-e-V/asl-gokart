import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
import { CH } from '@/ipc/channels';
import { fetchReleases, resolveFirmwareRelease } from './github-releases';
import { downloadFirmware, getCachedVersions, getEcuDefinition, getFirmwareLocalUrl, isDownloaded } from './firmware-manager';
import { getBindAddress } from '@/helpers/ipc/hardware/network-config';
import { FIRMWARE_SERVER_PORT } from '@/data/config';
import { EcuId } from '@/data/ecu/ecu-types';
import { sendOtaTrigger } from '@/main/adapters/sero';
import { assertKartStopped } from '@/main/standstill';
import { requireAdmin } from '@/main/admin';
import { getEcuStatus, onEcuPresenceChange } from './ecu-presence';
import { getFlashHistory } from './firmware-history';
import { cancelOta, getOtaProgress, onOtaProgress, startOtaTracker, trackOta } from './ota-tracker';

export function registerFirmwareListeners(mainWindow: BrowserWindow): void {
    ipcMain.handle(CH.firmware.getReleases, async (_event, ecuId: EcuId) => {
        return fetchReleases(getEcuDefinition(ecuId).githubAssetName);
    });

    ipcMain.handle(
        CH.firmware.download,
        requireAdmin(async (_event, ecuId: EcuId, tag: string) => {
            const def = getEcuDefinition(ecuId);
            if (isDownloaded(ecuId, tag)) {
                log.info(`[firmware] ${ecuId} ${tag} already cached, skipping download`);
                return { localUrl: getFirmwareLocalUrl(ecuId, tag) };
            }
            const release = await resolveFirmwareRelease(def.githubAssetName, tag);
            await downloadFirmware(ecuId, tag, release.downloadUrl);
            return { localUrl: getFirmwareLocalUrl(ecuId, tag) };
        })
    );

    ipcMain.handle(
        CH.firmware.triggerOta,
        requireAdmin(async (_event, ecuId: EcuId, tag: string) => {
            const url = getFirmwareLocalUrl(ecuId, tag);

            if (!isDownloaded(ecuId, tag)) {
                throw new Error(`Firmware ${ecuId} ${tag} is not downloaded. Download it first.`);
            }

            const ecuDef = getEcuDefinition(ecuId);

            if (!getEcuStatus()[ecuId].online) {
                throw new Error(`${ecuDef.displayName} is offline.`);
            }

            assertKartStopped();

            // Follow the flash from here on; progress arrives on CH.firmware.otaProgress.
            trackOta(ecuId, tag);
            try {
                await sendOtaTrigger(ecuDef.seroServiceId, url);
            } catch (err) {
                cancelOta(ecuId);
                throw err;
            }

            return { success: true, url };
        })
    );

    ipcMain.handle(CH.firmware.getServerUrl, async () => {
        const bindAddress = getBindAddress();
        return `http://${bindAddress}:${FIRMWARE_SERVER_PORT}`;
    });

    ipcMain.handle(CH.firmware.getCachedVersions, async () => {
        return getCachedVersions();
    });

    ipcMain.handle(CH.firmware.getEcuStatus, async () => {
        return getEcuStatus();
    });

    ipcMain.handle(CH.firmware.getFlashHistory, async () => {
        return getFlashHistory();
    });

    ipcMain.handle(CH.firmware.getOtaProgress, async (_event, ecuId: EcuId) => {
        return getOtaProgress(ecuId);
    });

    onEcuPresenceChange(() => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.firmware.ecuStatus, getEcuStatus());
    });

    startOtaTracker();
    onOtaProgress((progress) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.firmware.otaProgress, progress);
    });
}
