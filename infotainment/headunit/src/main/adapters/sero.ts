import { SeroRuntime, type RequestResult } from "@asl-gokart/sero-node";
import log from "electron-log/main";
import type { SignalName } from "@/domain/signals";
import { ECU_DEFINITIONS } from "@/data/ecu/ecu-definitions";
import { SERO_UNICAST_PORT, SERO_CLIENT_ID, ZC_OTA_METHOD_ID } from "@/data/config";
import { getBindAddress } from "@/helpers/ipc/hardware/network-config";
import { markServiceFound, markServiceLost, resetEcuPresence } from "@/helpers/ipc/firmware/ecu-presence";
import { get, markEcuLost, publish } from "@/main/signal-hub";
import { flowStateFor } from "@/lib/utils/flow-state";
import {
    hazardFromTurn,
    isValidTemp,
    powerKw,
    resetDerive,
    socFromVoltage,
    speedKmh,
    tempStats,
    throttlePercent,
} from "@/main/derive";
import { MockRuntime } from "@/main/adapters/mock";

/*
 * Sero adapter: the only main module that knows the zone controllers' wire format. It decodes events into
 * catalog signals on the signal hub and sends commands for the command bus. Mirrors
 * analytics/crates/ecu-sero/src/{lib,decoder}.rs; change both together.
 */

// --- ids (zc/zc_*/src/config.hpp, ecu-sero `ids`). Event ids have bit 15 set. ---
export const SERVICE = { LIGHTS: 0x0001, BUTTONS: 0x0002, BATTERY: 0x0003, MOTOR: 0x0004 } as const;

export const EVENT = {
    lights: { TURN: 0x8001, HIGH_BEAM: 0x8003, BRAKE: 0x8004, REVERSE: 0x8005, DRL: 0x8006, TAIL: 0x8007 },
    battery: { VOLTAGE: 0x8001, CURRENT: 0x8002, TEMPS: 0x8003 },
    motor: { TELEMETRY: 0x8001 },
} as const;

export const METHOD = {
    lights: {
        TURN_LEFT: 0x0002,
        TURN_RIGHT: 0x0003,
        HAZARD: 0x0004,
        HIGH_BEAM: 0x0006,
        BRAKE: 0x0007,
        REVERSE: 0x0008,
        DRL: 0x0009,
        WELCOME: 0x000a,
        /** `[strip, value]`, strip 0xFF = all */
        BRIGHTNESS: 0x000b,
        /** `[r, g, b]` */
        WELCOME_COLOR: 0x000c,
        TAIL: 0x000d,
    },
    motor: {
        /** `[relay]`, 0 = relay 1 */
        TOGGLE_RELAY: 0x0005,
    },
} as const;

/** Every event subscribed to, as `[service, event]` (ecu-sero SUBSCRIPTIONS). */
const SUBSCRIPTIONS: [number, number][] = [
    ...Object.values(EVENT.lights).map((e): [number, number] => [SERVICE.LIGHTS, e]),
    ...Object.values(EVENT.battery).map((e): [number, number] => [SERVICE.BATTERY, e]),
    [SERVICE.MOTOR, EVENT.motor.TELEMETRY],
];

/** Motor event: 19 bytes, or 23 with phase currents (ecu-sero MotorEvent). */
const MOTOR_LEN = 19;
const MOTOR_LEN_WITH_PHASE_CURRENT = 23;
const MAX_TEMP_SENSORS = 10;

/** Kelly switch bits packed by `pack_switches` in zc_motor/src/main.cpp. */
const SWITCHES = ["brake_switch", "foot_switch", "forward_switch", "reverse_switch", "setting_dir", "actual_dir"] as const;

const RT_INTERVAL = 10; // Interval in milliseconds for processing SeroRuntime events

/** The part of SeroRuntime this adapter uses, so MockRuntime can stand in for it. */
export type Runtime = Pick<
    SeroRuntime,
    "process" | "destroy" | "getLocalAddress" | "findService" | "subscribeEvent" | "onServiceFound" | "onServiceLost" | "onSubscriptionAck" | "fireAndForget" | "request"
>;

let rt: Runtime | null = null;
let rtInterval: ReturnType<typeof setInterval> | null = null;

const on = (v: number) => (v ? 1 : 0);

/** Lights events with an `[on]` payload. */
const SINGLE_LIGHTS: Record<number, SignalName> = {
    [EVENT.lights.BRAKE]: "lights.brake",
    [EVENT.lights.REVERSE]: "lights.reverse",
    [EVENT.lights.DRL]: "lights.drl",
    [EVENT.lights.TAIL]: "lights.tail",
};

// --- decoding ----------------------------------------------------------------------------

/** Reported once per event, so a firmware with another layout does not flood the log. */
const badLength = new Set<number>();

function reject(service: number, event: number, len: number, expected: string): void {
    const key = (service << 16) | event;
    if (badLength.has(key)) return;
    badLength.add(key);
    log.warn(`[SERO] service 0x${service.toString(16)} event 0x${event.toString(16)}: ${len} bytes, expected ${expected}`);
}

function lightsEvent(event: number, p: Buffer, ts: number): void {
    if (event === EVENT.lights.TURN || event === EVENT.lights.HIGH_BEAM) {
        if (p.length !== 2) return reject(SERVICE.LIGHTS, event, p.length, "2");
        if (event === EVENT.lights.TURN) {
            publish("lights.turn_left", on(p[0]), ts);
            publish("lights.turn_right", on(p[1]), ts);
            hazardFromTurn(p[0], p[1], (v) => publish("lights.hazard", v));
        } else {
            publish("lights.high_beam_left", on(p[0]), ts);
            publish("lights.high_beam_right", on(p[1]), ts);
        }
        return;
    }
    const name = SINGLE_LIGHTS[event];
    if (!name) return;
    if (p.length < 1) return reject(SERVICE.LIGHTS, event, p.length, "1");
    publish(name, on(p[0]), ts);
}

function batteryEvent(event: number, p: Buffer, ts: number): void {
    if (event === EVENT.battery.VOLTAGE || event === EVENT.battery.CURRENT) {
        if (p.length !== 4) return reject(SERVICE.BATTERY, event, p.length, "4");
        const value = p.readFloatLE(0);
        if (event === EVENT.battery.VOLTAGE) {
            publish("battery.voltage", value, ts);
            publish("battery.soc", socFromVoltage(value), ts);
        } else {
            publish("battery.current", value, ts);
            publish("drive.flow_state", flowStateFor(value), ts);
        }
        publish("battery.power", powerKw(get("battery.voltage"), get("battery.current")), ts);
        return;
    }
    if (event !== EVENT.battery.TEMPS) return;
    if (p.length === 0 || p.length % 4 !== 0) return reject(SERVICE.BATTERY, event, p.length, "a non-zero multiple of 4");
    const valid: number[] = [];
    for (let i = 0; i < Math.min(p.length / 4, MAX_TEMP_SENSORS); i++) {
        const t = p.readFloatLE(i * 4);
        const ok = isValidTemp(t);
        if (ok) valid.push(t);
        publish(`battery.temp_${i + 1}` as SignalName, ok ? t : null, ts);
    }
    const { max, min, avg } = tempStats(valid);
    publish("battery.temp", max, ts);
    publish("battery.temp_min", min, ts);
    publish("battery.temp_avg", avg, ts);
}

function motorEvent(p: Buffer, ts: number): void {
    if (p.length < MOTOR_LEN) return reject(SERVICE.MOTOR, EVENT.motor.TELEMETRY, p.length, "at least 19");
    for (const [side, o] of [["left", 0], ["right", 8]] as const) {
        publish(`drive.rpm_${side}`, p.readUInt16BE(o), ts);
        publish(`drive.throttle_raw_${side}`, p[o + 2], ts);
        publish(`drive.brake_raw_${side}`, p[o + 3], ts);
        SWITCHES.forEach((s, bit) => publish(`drive.${s}_${side}`, on(p[o + 4] & (1 << bit)), ts));
        publish(`battery.voltage_ctrl_${side}`, p[o + 5], ts);
        publish(`temp.motor_${side}`, p[o + 6], ts);
        publish(`temp.esc_${side}`, p[o + 7], ts);
    }
    publish("drive.relay_1", on(p[16]), ts);
    publish("drive.relay_2", on(p[17]), ts);
    publish("drive.reverse", on(p[18]), ts);
    if (p.length >= MOTOR_LEN_WITH_PHASE_CURRENT) {
        publish("drive.phase_current_raw_left", p.readUInt16BE(19), ts);
        publish("drive.phase_current_raw_right", p.readUInt16BE(21), ts);
    }
    publish("drive.throttle", throttlePercent(p[2], p[10]), ts);
    publish("drive.speed", speedKmh(p.readUInt16BE(0), p.readUInt16BE(8)), ts);
}

/** Decodes one event payload onto the signal hub. Unknown events are ignored. Exported for tests. */
export function handleEvent(service: number, event: number, payload: Buffer, ts = Date.now()): void {
    if (service === SERVICE.LIGHTS) lightsEvent(event, payload, ts);
    else if (service === SERVICE.BATTERY) batteryEvent(event, payload, ts);
    else if (service === SERVICE.MOTOR && event === EVENT.motor.TELEMETRY) motorEvent(payload, ts);
}

// --- runtime -----------------------------------------------------------------------------

const ecuIdFor = (serviceId: number) => ECU_DEFINITIONS.find((d) => d.seroServiceId === serviceId)?.id;

function markAllLost(): void {
    ECU_DEFINITIONS.forEach((d) => markEcuLost(d.id));
}

function createRuntime(): Runtime {
    // HEADUNIT_MOCK=1: a simulated kart instead of the car network, for development without hardware.
    if (process.env.HEADUNIT_MOCK) return new MockRuntime();
    const bindIp = getBindAddress();
    return new SeroRuntime({
        port: SERO_UNICAST_PORT,
        clientId: SERO_CLIENT_ID,
        bindIp,
    });
}

/** Starts discovery and publishes every subscribed event to the signal hub. */
export function startSeroAdapter(): void {
    if (rt) return;
    const runtime = createRuntime();
    rt = runtime;
    rtInterval = setInterval(() => runtime.process(), RT_INTERVAL);

    log.info("Starting SERO adapter...");
    log.info("SeroRuntime initialized on", runtime.getLocalAddress().ip, "port", runtime.getLocalAddress().port);

    // Services whose events this runtime subscribed to. Sero renews the subscriptions by itself
    // when a service is found again (e.g. after an OTA restart), so each is subscribed only once;
    // a second subscribeEvent would only swap the handler and leak the old JS callback.
    const subscribedServices = new Set<number>();

    runtime.onServiceFound((serviceId, address) => {
        log.info("Service found:", serviceId, "at", address);
        markServiceFound(serviceId, address.ip);
        if (subscribedServices.has(serviceId)) return;
        subscribedServices.add(serviceId);
        for (const [service, event] of SUBSCRIPTIONS) {
            if (service === serviceId) runtime.subscribeEvent(service, event, (s, e, payload) => handleEvent(s, e, payload));
        }
    });

    runtime.onServiceLost((serviceId) => {
        log.info("Service lost:", serviceId);
        markServiceLost(serviceId);
        const ecuId = ecuIdFor(serviceId);
        if (ecuId) markEcuLost(ecuId);
    });

    runtime.onSubscriptionAck((ack) => {
        log.debug("Subscription acknowledged:", ack);
    });

    Object.values(SERVICE).forEach((s) => runtime.findService(s));
}

export function stopSeroAdapter(): void {
    if (rtInterval) {
        clearInterval(rtInterval);
        rtInterval = null;
    }
    if (rt) {
        rt.destroy();
        rt = null;
        log.info("[SERO] SeroRuntime destroyed");
    }
    resetDerive();
    resetEcuPresence();
    markAllLost();
}

/** Rebinds on the currently selected network interface. */
export function restartSeroAdapter(): void {
    if (!rt) throw new Error("Sero adapter has not been started yet");
    stopSeroAdapter();
    startSeroAdapter();
}

function runtime(): Runtime {
    if (!rt) throw new Error("Sero runtime not started");
    return rt;
}

/** Throws when the runtime is not started; `false` when Sero could not send it. */
export const fireAndForget = (serviceId: number, methodId: number, payload: number[] = []): boolean =>
    runtime().fireAndForget(serviceId, methodId, Buffer.from(payload));

/** Throws when the runtime is not started. */
export const request = (serviceId: number, methodId: number, payload: number[]): Promise<RequestResult> =>
    runtime().request(serviceId, methodId, Buffer.from(payload));

// --- OTA ---------------------------------------------------------------------------------

/**
 * Send a firmware OTA trigger to a specific zone controller.
 * Sends the download URL as a Sero REQUEST to the ZC's own service using
 * the reserved OTA method ID (0x00FF). The ZC responds E_OK immediately,
 * then begins the update in a FreeRTOS background task and reboots.
 *
 * @param serviceId  The Sero service ID of the target ZC (from EcuDefinition.seroServiceId)
 * @param url        The HTTP URL of the firmware binary served by the in-vehicle file server
 */
export async function sendOtaTrigger(serviceId: number, url: string): Promise<void> {
    const hex = `0x${serviceId.toString(16).padStart(4, "0")}`;
    log.info(`[SERO] Sending OTA trigger to service ${hex}: ${url}`);
    const result = await runtime().request(serviceId, ZC_OTA_METHOD_ID, Buffer.from(url, "utf-8"));
    if (result.returnCode !== 0 /* E_OK */) {
        throw new Error(`[SERO] OTA trigger rejected by ECU (returnCode=${result.returnCode})`);
    }
    log.info(`[SERO] OTA trigger acknowledged by service ${hex}`);
}
