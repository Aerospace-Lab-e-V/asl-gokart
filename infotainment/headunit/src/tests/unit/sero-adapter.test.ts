const mockRuntime = {
    process: jest.fn(),
    destroy: jest.fn(),
    getLocalAddress: () => ({ ip: "0.0.0.0", port: 30491 }),
    onServiceFound: jest.fn(),
    onServiceLost: jest.fn(),
    onSubscriptionAck: jest.fn(),
    findService: jest.fn(),
    subscribeEvent: jest.fn(),
};

jest.mock("@asl-gokart/sero-node", () => ({ SeroRuntime: jest.fn(() => mockRuntime) }));
jest.mock("electron-log/main", () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("@/helpers/ipc/hardware/network-config", () => ({ getBindAddress: () => "0.0.0.0" }));

import { handleEvent, startSeroAdapter, stopSeroAdapter } from "@/main/adapters/sero";
import { get, getFresh, resetSignalHub } from "@/main/signal-hub";
import { resetDerive } from "@/main/derive";
import { FlowState } from "@/domain/signals";

const LIGHTS = 0x0001;
const BATTERY = 0x0003;
const MOTOR = 0x0004;

const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex");
const value = (name: Parameters<typeof get>[0]) => get(name)?.value;

/** ecu-sero tests/golden.rs MOTOR_19 (zc_motor/src/main.cpp `loop()`). */
const MOTOR_19 = "01 F4 80 00 06 3C 28 23  01 FE 7F 00 06 3B 29 24  01 00 00";

afterEach(() => {
    stopSeroAdapter();
    resetSignalHub();
    resetDerive();
});

test("motor golden vector maps to catalog names", () => {
    handleEvent(MOTOR, 0x8001, hex(MOTOR_19), 1);
    expect(value("drive.rpm_left")).toBe(500);
    expect(value("drive.rpm_right")).toBe(510);
    expect(value("drive.throttle_raw_left")).toBe(0x80);
    expect(value("drive.brake_raw_left")).toBe(0);
    expect(value("battery.voltage_ctrl_right")).toBe(59);
    expect(value("temp.motor_left")).toBe(40);
    expect(value("temp.esc_right")).toBe(36);
    expect(value("drive.foot_switch_left")).toBe(1);
    expect(value("drive.forward_switch_right")).toBe(1);
    expect(value("drive.brake_switch_left")).toBe(0);
    expect(value("drive.relay_1")).toBe(1);
    expect(value("drive.relay_2")).toBe(0);
    expect(value("drive.reverse")).toBe(0);
    expect(value("drive.phase_current_raw_left")).toBeUndefined();
    expect(value("drive.throttle")).toBeCloseTo(50.196, 2);
    expect(value("drive.speed")).toBeCloseTo(42.8745, 3);
});

test("motor phase currents at 23 bytes, shorter than 19 is rejected", () => {
    handleEvent(MOTOR, 0x8001, hex(`${MOTOR_19} 00 7B 01 C8`), 1);
    expect(value("drive.phase_current_raw_left")).toBe(123);
    expect(value("drive.phase_current_raw_right")).toBe(456);

    resetSignalHub();
    handleEvent(MOTOR, 0x8001, hex(MOTOR_19).subarray(0, 16), 1);
    expect(value("drive.rpm_left")).toBeUndefined();
});

test("battery floats are little-endian, power and flow state derived", () => {
    handleEvent(BATTERY, 0x8001, hex("00 00 42 42"), 1);
    expect(value("battery.voltage")).toBe(48.5);
    expect(value("battery.soc")).toBe(0);
    expect(value("battery.power")).toBeUndefined();

    handleEvent(BATTERY, 0x8002, Buffer.from(new Float32Array([-20]).buffer), 2);
    expect(value("battery.current")).toBe(-20);
    expect(value("battery.power")).toBeCloseTo(-0.97);
    expect(value("drive.flow_state")).toBe(FlowState.POWER);

    handleEvent(BATTERY, 0x8002, hex("00 00 42"), 3);
    expect(value("battery.current")).toBe(-20);
});

test("invalid temperature sensors are skipped, none valid gives null stats", () => {
    // 25.0, -127.0, 31.5
    handleEvent(BATTERY, 0x8003, Buffer.from(new Float32Array([25, -127, 31.5]).buffer), 1);
    expect(value("battery.temp_1")).toBe(25);
    expect(value("battery.temp_2")).toBeUndefined();
    expect(value("battery.temp")).toBe(31.5);
    expect(value("battery.temp_min")).toBe(25);
    expect(value("battery.temp_avg")).toBe(28.25);

    handleEvent(BATTERY, 0x8003, hex("00 00 FE C2"), 2);
    expect(value("battery.temp_1")).toBeUndefined();
    expect(value("battery.temp")).toBeUndefined();
    expect(value("battery.temp_min")).toBeUndefined();

    handleEvent(BATTERY, 0x8003, Buffer.alloc(0), 3);
    expect(value("battery.temp_avg")).toBeUndefined();
});

test("lights events, DRL is its own signal", () => {
    handleEvent(LIGHTS, 0x8001, Buffer.from([1, 0]), 1);
    handleEvent(LIGHTS, 0x8003, Buffer.from([0, 1]), 1);
    handleEvent(LIGHTS, 0x8004, Buffer.from([1]), 1);
    handleEvent(LIGHTS, 0x8005, Buffer.from([0]), 1);
    handleEvent(LIGHTS, 0x8006, Buffer.from([1]), 1);
    handleEvent(LIGHTS, 0x8007, Buffer.from([2]), 1);
    expect(value("lights.turn_left")).toBe(1);
    expect(value("lights.turn_right")).toBe(0);
    expect(value("lights.hazard")).toBe(0);
    expect(value("lights.high_beam_right")).toBe(1);
    expect(value("lights.brake")).toBe(1);
    expect(value("lights.reverse")).toBe(0);
    expect(value("lights.drl")).toBe(1);
    expect(value("lights.tail")).toBe(1);
});

test("subscribes every event once and marks a lost ECU stale", () => {
    startSeroAdapter();
    const [found] = mockRuntime.onServiceFound.mock.calls[0];
    const [lost] = mockRuntime.onServiceLost.mock.calls[0];
    found(LIGHTS, { ip: "192.168.1.21", port: 30491 });
    found(LIGHTS, { ip: "192.168.1.21", port: 30491 });
    const events = mockRuntime.subscribeEvent.mock.calls.map(([, e]) => e);
    expect(events).toEqual([0x8001, 0x8003, 0x8004, 0x8005, 0x8006, 0x8007]);

    handleEvent(LIGHTS, 0x8006, Buffer.from([1]), Date.now());
    lost(LIGHTS);
    expect(getFresh("lights.drl")).toBeUndefined();
});
