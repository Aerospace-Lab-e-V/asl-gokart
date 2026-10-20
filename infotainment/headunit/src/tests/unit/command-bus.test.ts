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

import { execute } from "@/main/command-bus";
import { startSeroAdapter, stopSeroAdapter } from "@/main/adapters/sero";
import type { Command } from "@/domain/commands";

const sentPayload = () => [...(mockRuntime.fireAndForget.mock.calls[0][2] as Buffer)];

beforeEach(() => {
    mockRuntime.fireAndForget.mockReturnValue(true);
    startSeroAdapter();
});
afterEach(stopSeroAdapter);

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

test("welcome, color and brightness payloads", async () => {
    await execute({ type: "lights.welcome" });
    expect(mockRuntime.fireAndForget).toHaveBeenLastCalledWith(0x0001, 0x000a, expect.any(Buffer));

    mockRuntime.fireAndForget.mockClear();
    await execute({ type: "lights.setWelcomeColor", rgb: [255, 0, 16] });
    expect(mockRuntime.fireAndForget.mock.calls[0][1]).toBe(0x000c);
    expect(sentPayload()).toEqual([255, 0, 16]);

    mockRuntime.fireAndForget.mockClear();
    await execute({ type: "lights.setBrightness", value: 128 });
    expect(mockRuntime.fireAndForget.mock.calls[0][1]).toBe(0x000b);
    expect(sentPayload()).toEqual([0xff, 128]);
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
    [{ type: "lights.setWelcomeColor", rgb: [256, 0, 0] }],
    [{ type: "lights.setWelcomeColor", rgb: [1, 2] }],
    [{ type: "lights.setBrightness", value: 1.5 }],
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
    expect((await execute({ type: "lights.welcome" })).ok).toBe(false);

    stopSeroAdapter();
    expect(await execute({ type: "lights.welcome" })).toEqual({ ok: false, error: "Sero runtime not started" });
});
