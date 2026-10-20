import { OtaPhase } from "@/data/ecu/ecu-types";
import {
    BOOT_TIMEOUT_MS,
    FETCH_TIMEOUT_MS,
    OtaEvent,
    OtaSession,
    reduceOtaSession,
    startOtaSession,
} from "@/helpers/ipc/firmware/ota-session";

/** Feeds events one second apart and returns the final session. */
const run = (events: OtaEvent[], from: OtaSession = startOtaSession("zc_lights", "v0.4.17", 0)) =>
    events.reduce((s, e, i) => reduceOtaSession(s, e, (i + 1) * 1000), from);

const downloaded: OtaEvent[] = [
    { type: "fetch-start", totalBytes: 1000 },
    { type: "fetch-progress", sentBytes: 430 },
    { type: "fetch-progress", sentBytes: 1000 },
    { type: "fetch-end", complete: true },
];

test("a flash goes through download and restart to online", () => {
    let s = run([{ type: "fetch-start", totalBytes: 1000 }, { type: "fetch-progress", sentBytes: 430 }]);
    expect(s.progress).toMatchObject({ phase: OtaPhase.EcuDownloading, percent: 43 });

    s = run([...downloaded, { type: "lost" }, { type: "found" }]);
    expect(s.progress).toEqual({ ecuId: "zc_lights", tag: "v0.4.17", phase: OtaPhase.Online });
});

test("found before the download ends does not count as the restart", () => {
    const s = run([{ type: "found" }, { type: "fetch-start", totalBytes: 1000 }, { type: "found" }]);
    expect(s.progress.phase).toBe(OtaPhase.EcuDownloading);
});

test("an ECU that never downloads fails the waiting phase", () => {
    const s = reduceOtaSession(startOtaSession("zc_lights", "v0.4.17", 0), { type: "tick" }, FETCH_TIMEOUT_MS + 1);
    expect(s.progress).toMatchObject({ phase: OtaPhase.Failed, failedPhase: OtaPhase.WaitingForEcu });
    expect(s.progress.error).toMatch(/never downloaded/);
});

test("an aborted or stalled download fails with the percentage reached", () => {
    const aborted = run([{ type: "fetch-start", totalBytes: 1000 }, { type: "fetch-progress", sentBytes: 430 }, { type: "fetch-end", complete: false }]);
    expect(aborted.progress).toMatchObject({ phase: OtaPhase.Failed, failedPhase: OtaPhase.EcuDownloading });
    expect(aborted.progress.error).toMatch(/43%/);

    const stalled = run([{ type: "fetch-start", totalBytes: 1000 }, { type: "fetch-progress", sentBytes: 430 }]);
    expect(reduceOtaSession(stalled, { type: "tick" }, 2000 + FETCH_TIMEOUT_MS + 1).progress.phase).toBe(OtaPhase.Failed);
});

test("no restart and no return give different errors", () => {
    const rebooting = run(downloaded);
    const tooLate = 4000 + BOOT_TIMEOUT_MS + 1;

    const notRestarted = reduceOtaSession(rebooting, { type: "tick" }, tooLate);
    expect(notRestarted.progress).toMatchObject({ phase: OtaPhase.Failed, failedPhase: OtaPhase.Rebooting });
    expect(notRestarted.progress.error).toMatch(/did not restart/);

    const lost = reduceOtaSession(rebooting, { type: "lost" }, 5000);
    expect(reduceOtaSession(lost, { type: "tick" }, tooLate).progress.error).toMatch(/did not come back/);
});

test("a finished session ignores further events", () => {
    const online = run([...downloaded, { type: "found" }]);
    expect(reduceOtaSession(online, { type: "tick" }, 10 ** 9)).toBe(online);
});
