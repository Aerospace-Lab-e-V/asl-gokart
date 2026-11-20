/** @jest-environment node */
import fs from "fs";
import os from "os";
import path from "path";
import { once } from "events";

jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import { spawn } from "child_process";
import { RELAUNCH_SCRIPT, relaunchAfterExit } from "@/helpers/ipc/updater/updater-manager";

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

test("closes fds inherited from this process before starting the app", async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "relaunch-")), "fds");
    // Extra stdio entries are fds 3-8 in the shell, open without FD_CLOEXEC like sero-node's sockets.
    const child = spawn("/bin/bash", ["-c", RELAUNCH_SCRIPT, "relaunch", "/bin/sh", "-c", 'echo /proc/$$/fd/* > "$0"', out], {
        stdio: ["pipe", "ignore", "ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    child.stdin!.end();
    await once(child, "exit");

    const fds = fs.readFileSync(out, "utf-8").trim().split(" ").map((p) => Number(path.basename(p)));
    // 0-2 and the directory fd the glob itself opens.
    expect(fds.filter((fd) => fd > 3)).toEqual([]);
});
