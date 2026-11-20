import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { ChildProcess, execFile, spawn } from 'child_process';
import log from 'electron-log/main';
import { UpdateProgress } from '@/data/updater/updater-types';
import { httpsGet } from '@/main/https-get';

export async function downloadDeb(
    downloadUrl: string,
    destPath: string,
    onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const res = await httpsGet(downloadUrl, 120_000);

    const total = parseInt(res.headers['content-length'] ?? '0', 10);
    let downloaded = 0;
    res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : -1;
        onProgress({ percent, bytesDownloaded: downloaded, totalBytes: total });
    });

    try {
        await pipeline(res, fs.createWriteStream(destPath));
    } catch (err) {
        fs.rmSync(destPath, { force: true });
        throw err;
    }
    log.info(`[updater-manager] Download complete: ${destPath}`);
}

export function installDeb(debPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        log.info(`[updater-manager] Running: sudo dpkg -i ${debPath}`);
        execFile('sudo', ['dpkg', '-i', debPath], (error, stdout, stderr) => {
            if (error) {
                log.error(`[updater-manager] dpkg failed: ${stderr}`);
                reject(new Error(stderr || error.message));
            } else {
                log.info(`[updater-manager] dpkg succeeded:\n${stdout}`);
                resolve();
            }
        });
    });
}

/**
 * Starts argv once this process has exited. Not app.relaunch(): Electron spawns its relauncher
 * helper without allow_new_privs, so Chromium sets PR_SET_NO_NEW_PRIVS on it and the relaunched
 * app inherits it, which makes the next update's `sudo dpkg -i` fail. The shell waits for EOF on
 * stdin, which comes when this process exits.
 */
export function relaunchAfterExit(argv: string[]): ChildProcess {
    const child = spawn('/bin/sh', ['-c', 'cat >/dev/null; exec "$@" </dev/null', 'relaunch', ...argv], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.unref();
    return child;
}
