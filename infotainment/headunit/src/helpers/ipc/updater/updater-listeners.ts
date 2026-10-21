import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log/main';
import { CH } from '@/ipc/channels';
import { requireAdmin } from '@/main/admin';
import { fetchAppReleases, resolveAppRelease } from './updater-github-releases';
import { downloadDeb, installDeb } from './updater-manager';

export function registerUpdaterListeners(mainWindow: BrowserWindow): void {
    ipcMain.handle(CH.updater.getReleases, async () => {
        return fetchAppReleases();
    });

    ipcMain.handle(
        CH.updater.install,
        requireAdmin(async (_event, tag: string) => {
            const { downloadUrl, assetName } = await resolveAppRelease(tag);
            const destPath = path.join(app.getPath('temp'), 'headunit-update', assetName);

            log.info(`[updater] Starting install of ${tag}`);

            if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
            }

            try {
                await downloadDeb(downloadUrl, destPath, (progress) => {
                    mainWindow.webContents.send(CH.updater.progress, progress);
                });

                await installDeb(destPath);
            } finally {
                try {
                    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                } catch {
                    // best effort cleanup
                }
            }
        })
    );

    ipcMain.handle(
        CH.updater.relaunch,
        requireAdmin(() => {
            log.info('[updater] Relaunching app after update');
            app.relaunch();
            app.quit();
        })
    );
}
