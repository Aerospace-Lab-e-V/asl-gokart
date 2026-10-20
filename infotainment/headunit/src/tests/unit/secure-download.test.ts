import fs from "fs";
import path from "path";

type MockRoute = { status: number; location?: string; body?: string };
const mockRoutes: Record<string, MockRoute> = {};

jest.mock("https", () => {
    const { Readable } = require("stream");
    const { EventEmitter } = require("events");
    const get = jest.fn((url: string, _opts: unknown, cb: (res: unknown) => void) => {
        const r = mockRoutes[url] ?? { status: 404 };
        const res = Object.assign(Readable.from(r.body === undefined ? [] : [Buffer.from(r.body)]), {
            statusCode: r.status,
            headers: r.location ? { location: r.location } : {},
        });
        const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => undefined });
        process.nextTick(() => cb(res));
        return req;
    });
    return { __esModule: true, default: { get }, get };
});
jest.mock("electron", () => {
    const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "headunit-download-"));
    return { app: { getPath: () => dir } };
});
jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import https from "https";
import { app } from "electron";
import { httpsGet } from "@/main/https-get";
import { downloadFirmware, getFirmwareLocalUrl, getFirmwarePath, isDownloaded } from "@/helpers/ipc/firmware/firmware-manager";
import { resolveFirmwareRelease } from "@/helpers/ipc/firmware/github-releases";
import { debAssetName, resolveAppRelease } from "@/helpers/ipc/updater/updater-github-releases";

const GH = "https://api.github.com/repos/Aerospace-Lab-e-V/asl-gokart/releases";
const asset = (name: string, url: string) => ({ name, size: 1, browser_download_url: url });
mockRoutes[GH] = {
    status: 200,
    body: JSON.stringify([
        {
            tag_name: "v1.0.0",
            name: "v1.0.0",
            prerelease: false,
            published_at: "2026-01-01T00:00:00Z",
            assets: [
                asset("firmware_zc_lights.bin", "https://github.com/fw"),
                asset(debAssetName("v1.0.0"), "https://github.com/deb"),
            ],
        },
        {
            tag_name: "v1/../../evil",
            name: "evil",
            prerelease: false,
            published_at: "2026-01-01T00:00:00Z",
            assets: [asset(debAssetName("v1/../../evil"), "https://github.com/evil")],
        },
    ]),
};

afterAll(() => fs.rmSync(app.getPath("userData"), { recursive: true, force: true }));

test("non-https URLs are refused before any request", async () => {
    await expect(httpsGet("http://github.com/fw", 1000)).rejects.toThrow("non-https");
    expect(https.get).not.toHaveBeenCalled();
});

test("https redirects are followed and the file appears only when complete", async () => {
    mockRoutes["https://github.com/fw"] = { status: 302, location: "https://cdn.example/fw.bin" };
    mockRoutes["https://cdn.example/fw.bin"] = { status: 200, body: "firmware" };

    await downloadFirmware("zc_lights", "v1.0.0", "https://github.com/fw");
    expect(fs.readFileSync(getFirmwarePath("zc_lights", "v1.0.0"), "utf8")).toBe("firmware");
    expect(isDownloaded("zc_lights", "v1.0.0")).toBe(true);
});

test("a redirect to http or an endless redirect chain fails without leaving a file", async () => {
    mockRoutes["https://github.com/down"] = { status: 302, location: "http://cdn.example/fw.bin" };
    await expect(downloadFirmware("zc_motor", "v1.0.0", "https://github.com/down")).rejects.toThrow("non-https");

    mockRoutes["https://github.com/loop"] = { status: 301, location: "/loop" };
    await expect(downloadFirmware("zc_motor", "v1.0.0", "https://github.com/loop")).rejects.toThrow("too many redirects");

    expect(fs.readdirSync(path.dirname(getFirmwarePath("zc_motor", "v1.0.0")))).toEqual([]);
});

test("firmware paths only take a known ECU and a plain tag", () => {
    for (const tag of ["../x", "..", ".hidden", "a/b", "a\\b", ""]) {
        expect(() => getFirmwarePath("zc_lights", tag)).toThrow("Invalid firmware tag");
        expect(() => isDownloaded("zc_lights", tag)).toThrow();
        expect(() => getFirmwareLocalUrl("zc_lights", tag)).toThrow();
    }
    expect(() => getFirmwarePath("../etc" as never, "v1.0.0")).toThrow("Unknown ECU id");
});

test("firmware and app releases resolve from the GitHub list by tag only", async () => {
    await expect(resolveFirmwareRelease("firmware_zc_lights.bin", "v1.0.0")).resolves.toMatchObject({
        downloadUrl: "https://github.com/fw",
    });
    await expect(resolveFirmwareRelease("firmware_zc_lights.bin", "v9.9.9")).rejects.toThrow("not found");

    await expect(resolveAppRelease("v1.0.0")).resolves.toMatchObject({ downloadUrl: "https://github.com/deb" });
    await expect(resolveAppRelease("v9.9.9")).rejects.toThrow("not found");
    await expect(resolveAppRelease("v1/../../evil")).rejects.toThrow("unexpected asset name");
});
