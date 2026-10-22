let body = "[]";

jest.mock("https", () => {
    const { Readable } = require("stream");
    const { EventEmitter } = require("events");
    const get = jest.fn((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
        const res = Object.assign(Readable.from([Buffer.from(body)]), { statusCode: 200, headers: {} });
        const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => undefined });
        process.nextTick(() => cb(res));
        return req;
    });
    return { __esModule: true, default: { get }, get };
});
jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import https from "https";
import { fetchReleases } from "@/helpers/ipc/firmware/github-releases";
import { debAssetName, fetchAppReleases } from "@/helpers/ipc/updater/updater-github-releases";

const release = {
    tag_name: "v1.0.0",
    name: "v1.0.0",
    prerelease: false,
    published_at: "2026-01-01T00:00:00Z",
    assets: [
        { name: "firmware_zc_lights.bin", size: 1, browser_download_url: "https://github.com/fw" },
        { name: debAssetName("v1.0.0"), size: 1, browser_download_url: "https://github.com/deb" },
    ],
};

const fetchAll = () =>
    Promise.all([fetchAppReleases(), fetchReleases("firmware_zc_lights.bin"), fetchReleases("firmware_zc_motor.bin")]);

test("concurrent callers share one request, and an empty list is not cached", async () => {
    expect(await fetchAll()).toEqual([[], [], []]);
    expect(https.get).toHaveBeenCalledTimes(1);

    body = JSON.stringify([release]);
    expect(await fetchAppReleases()).toHaveLength(1);
    expect(https.get).toHaveBeenCalledTimes(2);
});

test("the updater and every ECU are served from one cached list", async () => {
    jest.mocked(https.get).mockClear();
    const [app, lights, motor] = await fetchAll();
    expect([app.length, lights.length, motor.length]).toEqual([1, 1, 0]);
    expect(https.get).not.toHaveBeenCalled();
});
