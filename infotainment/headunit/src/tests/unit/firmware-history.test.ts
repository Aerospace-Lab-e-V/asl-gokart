import fs from "fs";
import os from "os";
import path from "path";

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "headunit-history-"));

jest.mock("electron", () => ({ app: { getPath: () => userData } }));
jest.mock("electron-log/main", () => ({ error: jest.fn() }));

import { getFlashHistory, recordFlash } from "@/helpers/ipc/firmware/firmware-history";

const file = path.join(userData, "firmware-history.json");

afterEach(() => fs.rmSync(file, { force: true }));
afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

test("no file means an empty history", () => {
    expect(getFlashHistory()).toEqual({});
});

test("a recorded flash is read back and replaces the previous one", () => {
    recordFlash("zc_lights", "v0.4.15");
    recordFlash("zc_motor", "v0.2.0");
    recordFlash("zc_lights", "v0.4.17");

    const history = getFlashHistory();
    expect(history.zc_lights?.tag).toBe("v0.4.17");
    expect(history.zc_motor?.tag).toBe("v0.2.0");
    expect(Number.isNaN(Date.parse(history.zc_lights!.flashedAt))).toBe(false);
});

test("a corrupt file gives an empty history", () => {
    fs.writeFileSync(file, "{ not json");
    expect(getFlashHistory()).toEqual({});
    fs.writeFileSync(file, "[1, 2]");
    expect(getFlashHistory()).toEqual({});
});
