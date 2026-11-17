/** @jest-environment node */
import { createHash } from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";

jest.mock("electron", () => ({ app: { getPath: () => os.tmpdir() }, ipcMain: { handle: jest.fn() } }));
jest.mock("electron-log/main", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import { MapPacks, mapServerFromBroker } from "@/main/map-packs";
import type { PackIndexEntry } from "@/data/map-packs";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** The map server: index.json plus whatever files the test puts in `files`. */
let files: Record<string, Buffer> = {};
let index: PackIndexEntry[] = [];
/** Requests for these paths hang until the test lets them go, to cancel a download midway. */
let hold: string | null = null;
let server: http.Server;
let base: string;
let dir: string;

const entry = (id: string, version: string, dark: Buffer, light: Buffer): PackIndexEntry => {
    files[`${id}-dark.pmtiles`] = dark;
    files[`${id}-light.pmtiles`] = light;
    return {
        id,
        title: id[0]!.toUpperCase() + id.slice(1),
        bbox: [8.8, 48.5, 8.9, 48.6],
        minzoom: 16,
        maxzoom: 19,
        version,
        attribution: "© OpenMapTiles © OpenStreetMap contributors",
        files: {
            dark: { path: `${id}-dark.pmtiles`, bytes: dark.length, sha256: sha(dark) },
            light: { path: `${id}-light.pmtiles`, bytes: light.length, sha256: sha(light) },
        },
    };
};

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const name = req.url!.replace(/^\/maps\//, "");
        if (name === "index.json") return void res.end(JSON.stringify(index));
        const body = files[name];
        if (!body) return void res.writeHead(404).end();
        res.writeHead(200, { "content-length": body.length });
        if (name === hold) return void res.write(body.subarray(0, 10));
        res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/maps/`;
});

afterAll(() => {
    server.closeAllConnections();
    server.close();
});

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-packs-"));
    files = {};
    index = [entry("herrenberg", "v1", Buffer.from("dark tiles v1"), Buffer.from("light tiles v1"))];
    hold = null;
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const store = (opts: Partial<ConstructorParameters<typeof MapPacks>[0]> = {}) =>
    new MapPacks({ dir, resolveServer: async () => base, ...opts });

test("the map server is the telemetry broker's host", () => {
    expect(mapServerFromBroker("mqtt://pit:1883")).toBe("http://pit:8080/maps/");
    expect(mapServerFromBroker("mqtt://192.168.1.10:1883")).toBe("http://192.168.1.10:8080/maps/");
    expect(mapServerFromBroker("")).toBeNull();
    expect(mapServerFromBroker("not a url")).toBeNull();
});

test("lists the server's areas, downloads one and keeps it across restarts", async () => {
    const onInstalledChange = jest.fn();
    const packs = store({ onInstalledChange });
    const listed = await packs.refresh();
    expect(listed).toMatchObject({ server: base, serverError: null, download: null });
    expect(listed.areas).toEqual([{ id: "herrenberg", title: "Herrenberg", bytes: 27, installed: null, available: { version: "v1" } }]);

    await packs.install("herrenberg");

    expect(fs.readFileSync(packs.file("herrenberg", "dark"), "utf-8")).toBe("dark tiles v1");
    expect(fs.readFileSync(packs.file("herrenberg", "light"), "utf-8")).toBe("light tiles v1");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".part"))).toEqual([]);
    expect(onInstalledChange).toHaveBeenCalledTimes(1);
    expect(packs.state().areas[0]!.installed).toMatchObject({ version: "v1" });

    // A new start reads the manifest; the server being down does not hide what is installed.
    const later = store({ resolveServer: async () => Promise.reject(new Error("connect ECONNREFUSED")) });
    const state = await later.refresh();
    expect(state.serverError).toBe("connect ECONNREFUSED");
    expect(state.areas).toEqual([expect.objectContaining({ id: "herrenberg", installed: expect.objectContaining({ version: "v1" }), available: null })]);
    expect(later.installedPacks()[0]).toMatchObject({ id: "herrenberg", bbox: [8.8, 48.5, 8.9, 48.6], minzoom: 16, maxzoom: 19 });
});

test("reports progress while downloading", async () => {
    const states: { bytes: number; total: number }[] = [];
    const packs = store({ onState: (s) => s.download && states.push(s.download) });
    await packs.refresh();
    await packs.install("herrenberg");
    expect(states[0]).toEqual({ id: "herrenberg", bytes: 0, total: 27 });
    expect(packs.state().download).toBeNull();
});

test("a damaged file replaces nothing", async () => {
    const packs = store();
    await packs.refresh();
    await packs.install("herrenberg");

    index = [entry("herrenberg", "v2", Buffer.from("dark tiles v2"), Buffer.from("light tiles v2"))];
    await packs.refresh();
    files["herrenberg-light.pmtiles"] = Buffer.from("light tiles XX");

    await expect(packs.install("herrenberg")).rejects.toThrow("herrenberg-light.pmtiles arrived damaged");
    expect(fs.readFileSync(packs.file("herrenberg", "dark"), "utf-8")).toBe("dark tiles v1");
    expect(packs.state().areas[0]!.installed!.version).toBe("v1");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".part"))).toEqual([]);
});

test("an update replaces both files once both arrived", async () => {
    const packs = store();
    await packs.refresh();
    await packs.install("herrenberg");
    index = [entry("herrenberg", "v2", Buffer.from("dark tiles v2"), Buffer.from("light tiles v2"))];
    const state = await packs.refresh();
    expect(state.areas[0]).toMatchObject({ installed: { version: "v1" }, available: { version: "v2" } });

    await packs.install("herrenberg");
    expect(fs.readFileSync(packs.file("herrenberg", "dark"), "utf-8")).toBe("dark tiles v2");
    expect(fs.readFileSync(packs.file("herrenberg", "light"), "utf-8")).toBe("light tiles v2");
    expect(packs.state().areas[0]!.installed!.version).toBe("v2");
});

test("cancelling leaves no partial files, one download at a time", async () => {
    const packs = store();
    await packs.refresh();
    hold = "herrenberg-light.pmtiles";
    const download = packs.install("herrenberg");
    await new Promise((r) => setTimeout(r, 50));
    await expect(packs.install("herrenberg")).rejects.toThrow("Another map is downloading");

    packs.cancel();
    await expect(download).rejects.toThrow("Download cancelled");
    expect(fs.readdirSync(dir).filter((f) => f.includes("herrenberg"))).toEqual([]);
    expect(packs.state().areas[0]!.installed).toBeNull();
});

test("delete removes the files and the manifest entry", async () => {
    const onInstalledChange = jest.fn();
    const packs = store({ onInstalledChange });
    await packs.refresh();
    await packs.install("herrenberg");
    await packs.remove("herrenberg");

    expect(fs.existsSync(packs.file("herrenberg", "dark"))).toBe(false);
    expect(packs.installedPacks()).toEqual([]);
    expect(onInstalledChange).toHaveBeenCalledTimes(2);
    expect(store().installedPacks()).toEqual([]);
});

test("refuses an index that points anywhere but the server's own files", async () => {
    index = [{ ...index[0]!, files: { ...index[0]!.files, dark: { ...index[0]!.files.dark, path: "../../etc/passwd" } } }];
    const state = await store().refresh();
    expect(state.serverError).toMatch(/path/);
    expect(state.areas).toEqual([]);
});

test("no broker set means no map server, not an error", async () => {
    const state = await store({ resolveServer: async () => null }).refresh();
    expect(state).toMatchObject({ server: null, serverError: null, areas: [] });
});
