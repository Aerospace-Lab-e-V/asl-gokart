import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log/main';
import { getBindAddress } from '@/helpers/ipc/hardware/network-config';
import { FIRMWARE_SERVER_PORT } from '@/data/config';

let currentServer: http.Server | null = null;

/** An ECU downloading a binary, for following a flash. */
export type FirmwareFetchEvent = { ecuId: string; tag: string } & (
    | { kind: 'start'; totalBytes: number }
    | { kind: 'progress'; sentBytes: number }
    | { kind: 'end'; complete: boolean }
);

const fetchListeners = new Set<(event: FirmwareFetchEvent) => void>();

/** Returns a function that removes the listener. */
export function onFirmwareFetch(listener: (event: FirmwareFetchEvent) => void): () => void {
    fetchListeners.add(listener);
    return () => fetchListeners.delete(listener);
}

const emitFetch = (event: FirmwareFetchEvent) => fetchListeners.forEach((l) => l(event));

function getFirmwareCacheRoot(): string {
    return path.join(app.getPath('userData'), 'firmware');
}

export function startFirmwareServer(): void {
    const bindAddress = getBindAddress();
    const cacheRoot = getFirmwareCacheRoot();

    const server = http.createServer((req, res) => {
        if (!req.url) {
            res.writeHead(400);
            res.end('Bad Request');
            return;
        }

        // Expected path: /firmware/:ecuId/:tag/fw.bin
        const match = req.url.match(/^\/firmware\/([^/]+)\/([^/]+)\/fw\.bin$/);
        if (!match) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        const [, ecuId, tag] = match;
        const filePath = path.join(cacheRoot, ecuId, tag, 'fw.bin');

        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('Firmware not found');
            return;
        }

        const stat = fs.statSync(filePath);
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${ecuId}_${tag}.bin"`,
        });

        const stream = fs.createReadStream(filePath);
        let sentBytes = 0;
        emitFetch({ ecuId, tag, kind: 'start', totalBytes: stat.size });
        stream.on('data', (chunk) => {
            sentBytes += chunk.length;
            emitFetch({ ecuId, tag, kind: 'progress', sentBytes });
        });
        // 'close' follows 'finish' too; only a connection closed before the end is incomplete.
        res.on('close', () => emitFetch({ ecuId, tag, kind: 'end', complete: res.writableFinished }));
        stream.on('error', (err) => {
            log.error(`[firmware-server] Error streaming file ${filePath}:`, err.message);
            res.end();
        });
        stream.pipe(res);

        log.info(`[firmware-server] Served ${filePath} to ${req.socket.remoteAddress}`);
    });

    currentServer = server;

    server.listen(FIRMWARE_SERVER_PORT, bindAddress, () => {
        log.info(`[firmware-server] Running on http://${bindAddress}:${FIRMWARE_SERVER_PORT}`);
    });

    server.on('error', (err) => {
        log.error(`[firmware-server] Error: ${err.message}`);
    });
}

export function stopFirmwareServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!currentServer) {
            resolve();
            return;
        }
        currentServer.close((err) => {
            if (err) {
                log.error(`[firmware-server] Error stopping: ${err.message}`);
                reject(err);
            } else {
                log.info('[firmware-server] Stopped');
                currentServer = null;
                resolve();
            }
        });
    });
}

export async function restartFirmwareServer(): Promise<void> {
    await stopFirmwareServer();
    startFirmwareServer();
}
