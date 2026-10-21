import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { app } from 'electron';
import log from 'electron-log/main';
import { EcuDefinition, EcuId } from '@/data/ecu/ecu-types';
import { ECU_DEFINITIONS } from '@/data/ecu/ecu-definitions';
import { getBindAddress } from '@/helpers/ipc/hardware/network-config';
import { FIRMWARE_SERVER_PORT } from '@/data/config';
import { httpsGet } from '@/main/https-get';

/** Release tags become directory names: word characters, dots and dashes, not starting with a dot. */
const SAFE_TAG = /^(?!\.)[\w.-]+$/;

export function getEcuDefinition(ecuId: EcuId): EcuDefinition {
    const def = ECU_DEFINITIONS.find((d) => d.id === ecuId);
    if (!def) throw new Error(`Unknown ECU id: ${ecuId}`);
    return def;
}

/** Throws unless ecuId and tag are safe to use as path segments. */
export function assertSafeFirmwareId(ecuId: EcuId, tag: string): void {
    getEcuDefinition(ecuId);
    if (typeof tag !== 'string' || !SAFE_TAG.test(tag)) throw new Error(`Invalid firmware tag: ${tag}`);
}

export function getFirmwarePath(ecuId: EcuId, tag: string): string {
    assertSafeFirmwareId(ecuId, tag);
    return path.join(app.getPath('userData'), 'firmware', ecuId, tag, 'fw.bin');
}

export function isDownloaded(ecuId: EcuId, tag: string): boolean {
    return fs.existsSync(getFirmwarePath(ecuId, tag));
}

export async function downloadFirmware(ecuId: EcuId, tag: string, downloadUrl: string): Promise<void> {
    const filePath = getFirmwarePath(ecuId, tag);
    // Written next to fw.bin and renamed when complete, so a cut download is never served as firmware.
    const partPath = `${filePath}.part`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    log.info(`[firmware-manager] Downloading ${ecuId} ${tag} from ${downloadUrl}`);
    const res = await httpsGet(downloadUrl, 60_000);
    try {
        await pipeline(res, fs.createWriteStream(partPath));
        fs.renameSync(partPath, filePath);
    } catch (err) {
        fs.rmSync(partPath, { force: true });
        throw err;
    }
    log.info(`[firmware-manager] Downloaded ${ecuId} ${tag} to ${filePath}`);
}

export function getCachedVersions(): Record<string, string[]> {
    const root = path.join(app.getPath('userData'), 'firmware');
    const result: Record<string, string[]> = {};

    if (!fs.existsSync(root)) return result;

    for (const ecuId of fs.readdirSync(root)) {
        const ecuDir = path.join(root, ecuId);
        if (!fs.statSync(ecuDir).isDirectory()) continue;
        result[ecuId] = fs.readdirSync(ecuDir).filter((tag) => {
            return fs.existsSync(path.join(ecuDir, tag, 'fw.bin'));
        });
    }

    return result;
}

export function getFirmwareLocalUrl(ecuId: EcuId, tag: string): string {
    assertSafeFirmwareId(ecuId, tag);
    const bindAddress = getBindAddress();
    return `http://${bindAddress}:${FIRMWARE_SERVER_PORT}/firmware/${ecuId}/${tag}/fw.bin`;
}
