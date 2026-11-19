/** @jest-environment node */
import fs from "fs";
import os from "os";
import path from "path";
import { once } from "events";

jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import { relaunchAfterExit } from "@/helpers/ipc/updater/updater-manager";

const noNewPrivs = (status: string) => status.match(/^NoNewPrivs:.*$/m)?.[0];

test("relaunches only after this process exits, without adding no_new_privs", async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "relaunch-")), "status");
    const child = relaunchAfterExit(["/bin/sh", "-c", 'cat /proc/self/status > "$0"', out]);

    await new Promise((r) => setTimeout(r, 200));
    expect(fs.existsSync(out)).toBe(false);

    child.stdin!.end(); // what this process exiting does
    await once(child, "exit");
    expect(noNewPrivs(fs.readFileSync(out, "utf-8"))).toBe(noNewPrivs(fs.readFileSync("/proc/self/status", "utf-8")));
});
