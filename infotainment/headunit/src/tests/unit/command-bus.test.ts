const mockRuntime = {
    process: jest.fn(),
    destroy: jest.fn(),
    getLocalAddress: () => ({ ip: "0.0.0.0", port: 30491 }),
    onServiceFound: jest.fn(),
    onServiceLost: jest.fn(),
    onSubscriptionAck: jest.fn(),
    findService: jest.fn(),
    subscribeEvent: jest.fn(),
    fireAndForget: jest.fn(),
    request: jest.fn(),
};

jest.mock("@asl-gokart/sero-node", () => ({ SeroRuntime: jest.fn(() => mockRuntime) }));
jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("@/helpers/ipc/hardware/network-config", () => ({ getBindAddress: () => "0.0.0.0" }));

jest.mock("@/helpers/ipc/application/system-config", () => ({
    // sha256("1234")
    getAdminPinHash: () => "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
}));

import { execute } from "@/main/command-bus";
import { startSeroAdapter, stopSeroAdapter } from "@/main/adapters/sero";
import { encodeLightsConfig, defaultLightsConfig } from "@/main/adapters/lights-config-codec";
import { get, publish, resetSignalHub } from "@/main/signal-hub";
import { lock, unlock } from "@/main/admin";
import type { Command } from "@/domain/commands";

const sentPayload = () => [...(mockRuntime.fireAndForget.mock.calls[0][2] as Buffer)];

beforeEach(() => {
    mockRuntime.fireAndForget.mockReturnValue(true);
    startSeroAdapter();
});
afterEach(() => {
    stopSeroAdapter();
    resetSignalHub();
    lock();
});

const answer = (returnCode: number, payload = Buffer.alloc(0)) => ({ returnCode, payload });

test.each([
    ["turn_left", 0x0002],
    ["turn_right", 0x0003],
    ["hazard", 0x0004],
    ["high_beam", 0x0006],
    ["brake", 0x0007],
    ["reverse", 0x0008],
    ["drl", 0x0009],
    ["tail", 0x000d],
] as const)("lights.toggle %s sends method %d", async (light, method) => {
    expect(await execute({ type: "lights.toggle", light })).toEqual({ ok: true });
    expect(mockRuntime.fireAndForget).toHaveBeenCalledWith(0x0001, method, expect.any(Buffer));
});

test.each([
    ["drl", 0x0009, true, 1],
    ["tail", 0x000d, false, 0],
    ["brake", 0x0007, true, 1],
    ["reverse", 0x0008, false, 0],
    ["high_beam", 0x0006, true, 1],
] as const)("lights.set %s sends method %d with [on]", async (light, method, on, byte) => {
    expect(await execute({ type: "lights.set", light, on })).toEqual({ ok: true });
    expect(mockRuntime.fireAndForget.mock.calls[0][1]).toBe(method);
    expect(sentPayload()).toEqual([byte]);
});

test("setWelcome sends only the given fields in the mask and publishes the ECU's answer", async () => {
    const echo = { ...defaultLightsConfig(), front: 1, ambient: 128 };
    mockRuntime.request.mockResolvedValueOnce(answer(0, encodeLightsConfig(echo)));
    expect(await execute({ type: "lights.setWelcome", front: 1, ambient: 128 })).toEqual({ ok: true });
    expect(mockRuntime.request).toHaveBeenCalledWith(0x0001, 0x000e, Buffer.from([0b1010, 0, 1, 0, 128]));
    expect(get("lights.welcome_front")?.value).toBe(1);
    expect(get("lights.ambient")?.value).toBe(128);

    mockRuntime.request.mockResolvedValueOnce(answer(0, encodeLightsConfig(echo)));
    await execute({ type: "lights.setWelcome", enabled: false, rear: 2 });
    expect(mockRuntime.request).toHaveBeenLastCalledWith(0x0001, 0x000e, Buffer.from([0b0101, 0, 0, 2, 0]));
});

test("setWelcome reports the ECU's refusal and publishes nothing", async () => {
    mockRuntime.request.mockResolvedValueOnce(answer(1));
    expect((await execute({ type: "lights.setWelcome", enabled: true })).ok).toBe(false);
    mockRuntime.request.mockResolvedValueOnce(answer(3));
    expect(await execute({ type: "lights.setWelcome", enabled: true })).toEqual({ ok: false, error: "zc_lights firmware is too old for this" });
    expect(get("lights.welcome_enabled")).toBeUndefined();
});

test("setAnimationColor sends layer, id and colour", async () => {
    mockRuntime.request.mockResolvedValueOnce(answer(0, encodeLightsConfig(defaultLightsConfig())));
    expect(await execute({ type: "lights.setAnimationColor", layer: "rear", id: 2, rgb: [1, 2, 3] })).toEqual({ ok: true });
    expect(mockRuntime.request).toHaveBeenCalledWith(0x0001, 0x000f, Buffer.from([1, 2, 1, 2, 3]));
});

test("welcome plays only at a standstill, or in admin mode without a speed", async () => {
    mockRuntime.request.mockResolvedValue(answer(0));

    expect((await execute({ type: "lights.welcome" })).ok).toBe(false); // no speed, not admin
    expect(mockRuntime.request).not.toHaveBeenCalled();

    unlock("1234");
    expect(await execute({ type: "lights.welcome" })).toEqual({ ok: true }); // booth: admin, no speed
    expect(mockRuntime.request).toHaveBeenLastCalledWith(0x0001, 0x000a, Buffer.alloc(0));

    publish("drive.speed", 8);
    expect((await execute({ type: "lights.welcome" })).ok).toBe(false); // moving, even as admin

    publish("drive.speed", 0);
    lock();
    expect(await execute({ type: "lights.welcome" })).toEqual({ ok: true });

    mockRuntime.request.mockResolvedValueOnce(answer(4));
    expect(await execute({ type: "lights.welcome" })).toEqual({ ok: false, error: expect.stringMatching(/refused/) });
});

test("relay toggle is ok only when the ECU returns E_OK", async () => {
    mockRuntime.request.mockResolvedValueOnce({ returnCode: 0, payload: Buffer.alloc(0) });
    expect(await execute({ type: "motor.toggleRelay", relay: 1 })).toEqual({ ok: true });
    expect(mockRuntime.request).toHaveBeenCalledWith(0x0004, 0x0005, Buffer.from([1]));

    mockRuntime.request.mockResolvedValueOnce({ returnCode: 1, payload: Buffer.alloc(0) });
    expect((await execute({ type: "motor.toggleRelay", relay: 0 })).ok).toBe(false);
});

test.each([
    [{ type: "lights.toggle", light: "headlights" }],
    [{ type: "lights.toggle", light: "toString" }],
    [{ type: "lights.set", light: "hazard", on: true }],
    [{ type: "lights.set", light: "drl", on: 1 }],
    [{ type: "lights.setWelcome" }],
    [{ type: "lights.setWelcome", front: 9 }],
    [{ type: "lights.setWelcome", ambient: 300 }],
    [{ type: "lights.setWelcome", enabled: "yes" }],
    [{ type: "lights.setAnimationColor", layer: "rear", id: 1, rgb: [1, 2, 3] }],
    [{ type: "lights.setAnimationColor", layer: "front", id: 0, rgb: [256, 0, 0] }],
    [{ type: "lights.setAnimationColor", layer: "top", id: 0, rgb: [1, 2, 3] }],
    [{ type: "motor.toggleRelay", relay: 2 }],
    [{ type: "nope" }],
    [null],
])("rejects bad command %j", async (command) => {
    const result = await execute(command as unknown as Command);
    expect(result.ok).toBe(false);
    expect(mockRuntime.fireAndForget).not.toHaveBeenCalled();
    expect(mockRuntime.request).not.toHaveBeenCalled();
});

test("fails while the runtime is not started or cannot send", async () => {
    mockRuntime.fireAndForget.mockReturnValueOnce(false);
    expect((await execute({ type: "lights.toggle", light: "drl" })).ok).toBe(false);

    stopSeroAdapter();
    expect(await execute({ type: "lights.toggle", light: "drl" })).toEqual({ ok: false, error: "Sero runtime not started" });
});
