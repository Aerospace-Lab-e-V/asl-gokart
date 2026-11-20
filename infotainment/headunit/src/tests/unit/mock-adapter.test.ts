jest.mock("@asl-gokart/sero-node", () => ({ SeroRuntime: jest.fn() }));
jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("@/helpers/ipc/hardware/network-config", () => ({ getBindAddress: () => "0.0.0.0" }));

import { MockRuntime } from "@/main/adapters/mock";
import { handleEvent } from "@/main/adapters/sero";
import { getFresh, resetSignalHub } from "@/main/signal-hub";
import { resetDerive } from "@/main/derive";
import { FlowState, type SignalName } from "@/domain/signals";

afterEach(() => {
    resetSignalHub();
    resetDerive();
});

/** Drives the mock through the real decoder for `seconds` of simulated time, sampling every tick. */
function run(seconds: number, beforeTick?: (rt: MockRuntime, ms: number) => void) {
    const rt = new MockRuntime();
    rt.onServiceFound((service) => {
        for (let event = 0x8001; event <= 0x8009; event++) rt.subscribeEvent(service, event, (s, e, p) => handleEvent(s, e, p));
    });
    [1, 2, 3, 4].forEach((s) => rt.findService(s));
    const seen: Partial<Record<SignalName, number[]>> = {};
    for (let ms = 0; ms <= seconds * 1000; ms += 100) {
        beforeTick?.(rt, ms);
        rt.process(ms);
        for (const name of ["drive.speed", "drive.rpm_left", "drive.reverse", "drive.flow_state", "battery.soc", "temp.motor_left", "battery.temp_avg", "lights.turn_left", "lights.hazard"] as SignalName[]) {
            const v = getFresh(name);
            if (v !== undefined) (seen[name] ??= []).push(v);
        }
    }
    return seen;
}

test("two laps drive the kart through every state", () => {
    const seen = run(112);
    expect(Math.max(...seen["drive.speed"]!)).toBeGreaterThan(80);
    expect(seen["drive.speed"]).toContain(0);
    expect(seen["drive.rpm_left"]!.every((r) => r >= 0 && r <= 1500)).toBe(true);
    expect(seen["drive.reverse"]).toContain(1);
    expect(seen["drive.flow_state"]).toEqual(expect.arrayContaining([FlowState.POWER, FlowState.REGEN, FlowState.IDLE]));
    expect(seen["battery.soc"]!.every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(seen["temp.motor_left"]!.at(-1)).toBeGreaterThan(seen["temp.motor_left"]![0]);
    expect(seen["battery.temp_avg"]!.length).toBeGreaterThan(0);
    expect(seen["lights.turn_left"]).toEqual(expect.arrayContaining([0, 1]));
});

test("hazard toggle blinks both sides and reads as hazard", () => {
    const seen = run(3, (rt, ms) => ms === 0 && rt.fireAndForget(0x0001, 0x0004));
    expect(seen["lights.hazard"]).toContain(1);
});

test("zc_lights welcome settings: GET, SET and the playing pulse", async () => {
    const rt = new MockRuntime();
    rt.onServiceFound((service) => {
        for (let event = 0x8001; event <= 0x8009; event++) rt.subscribeEvent(service, event, (s, e, p) => handleEvent(s, e, p));
    });
    [1, 2, 3, 4].forEach((s) => rt.findService(s));
    rt.process(0);

    const get = await rt.request(0x0001, 0x0010, Buffer.alloc(0));
    expect(get.returnCode).toBe(0);
    expect(get.payload[0]).toBe(1); // blob version

    const set = await rt.request(0x0001, 0x000e, Buffer.from([0b0110, 0, 2, 1, 0]));
    expect(set.returnCode).toBe(0);
    expect(getFresh("lights.welcome_front")).toBe(2); // the config event
    expect(getFresh("lights.welcome_rear")).toBe(1);

    expect((await rt.request(0x0001, 0x000f, Buffer.from([1, 1, 0, 0, 255]))).returnCode).toBe(1); // wing: fixed colour

    expect((await rt.request(0x0001, 0x000a, Buffer.alloc(0))).returnCode).toBe(0);
    rt.process(100);
    expect(getFresh("lights.welcome_playing")).toBe(1);
    rt.process(100 + 4000); // sweep 1500 / cue 1100 + wing 1700 + settle 400 = 3200 ms
    expect(getFresh("lights.welcome_playing")).toBe(0);
});
