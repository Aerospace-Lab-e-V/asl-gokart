import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log/main';
import { EcuId, FlashHistory } from '@/data/ecu/ecu-types';

/*
 * The ECUs do not report their firmware version yet, so the headunit remembers what it flashed.
 * Only flashes that brought the ECU back online are recorded.
 */

const historyFile = () => path.join(app.getPath('userData'), 'firmware-history.json');

export function getFlashHistory(): FlashHistory {
    try {
        const file = historyFile();
        if (!fs.existsSync(file)) return {};
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        log.error('[firmware-history] Failed to read the flash history:', e);
        return {};
    }
}

export function recordFlash(ecuId: EcuId, tag: string): void {
    const history: FlashHistory = { ...getFlashHistory(), [ecuId]: { tag, flashedAt: new Date().toISOString() } };
    try {
        fs.writeFileSync(historyFile(), JSON.stringify(history, null, 2), 'utf-8');
    } catch (e) {
        log.error('[firmware-history] Failed to write the flash history:', e);
    }
}
