import type { Address, RequestResult } from "@asl-gokart/sero-node";
import { BATTERY_MAX_VOLTAGE, BATTERY_MIN_VOLTAGE } from "@/data/battery-config";
import { WHEEL_CIRCUMFERENCE_M } from "@/main/derive";
import { EVENT, METHOD, SERVICE, type Runtime } from "@/main/adapters/sero";

/*
 * A simulated kart behind the Sero runtime interface (HEADUNIT_MOCK=1). It sends the zone controllers'
 * real event payloads, so the adapter decodes and derives everything exactly as on the kart, and it
 * answers light and relay commands like the firmware does. A driver loops one lap; the rest is physics.
 */

type EventHandler = (serviceId: number, eventId: number, payload: Buffer) => void;

/** `[t s, target km/h]`, linear in between, looping; negative is reverse. */
const LAP: [number, number][] = [
    [0, 0], [3, 0], [14, 95], [17, 95], [21, 30], [29, 35], [37, 65], [42, 0], [45, 0], [46, -6], [50, -6], [51, 0], [56, 0],
];
const LAP_S = LAP[LAP.length - 1][0];
/** `[from s, to s, side]`: the driver signals before the corner and before pulling over. */
const SIGNALS: [number, number, "left" | "right"][] = [[15, 21, "left"], [36, 42, "right"]];
/** Corner where the outer wheel turns faster. */
const CORNER: [number, number] = [21, 29];

const KMH_PER_RPM = (WHEEL_CIRCUMFERENCE_M * 3.6) / 60;
const AMBIENT_C = 22;
const CAPACITY_AH = 40;
const PACK_OHM = 0.008;
const BLINK_MS = 400;
const TEMPS_EVERY_S = 2;
/** Fixed sensor spread across the 10 pack sensors. */
const CELL_OFFSETS = [-1.2, -0.4, 0.3, 0.8, 1.5, -0.8, 0.1, 0.6, -0.3, 1.1];

export interface Sim {
    /** Lap time, s. */
    t: number;
    /** Signed, km/h. */
    speed: number;
    /** Pedals, 0-100 %. */
    throttle: number;
    brake: number;
    reverse: boolean;
    /** A; negative is drawn from the pack, positive is regen (flowStateFor's convention). */
    current: number;
    soc: number;
    motorTemp: number;
    escTemp: number;
    packTemp: number;
}

export const initialSim = (): Sim => ({
    t: 0, speed: 0, throttle: 0, brake: 0, reverse: false, current: 0, soc: 88, motorTemp: 24, escTemp: 23, packTemp: AMBIENT_C,
});

export function lapTarget(t: number): number {
    const i = LAP.findIndex(([at]) => at > t);
    const [t0, v0] = LAP[i - 1];
    const [t1, v1] = LAP[i];
    return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const approach = (v: number, to: number, maxStep: number) => v + clamp(to - v, -maxStep, maxStep);

/** Advances the kart by `dt` seconds. */
export function step(s: Sim, dt: number): void {
    s.t = (s.t + dt) % LAP_S;
    const target = lapTarget(s.t);
    const v = Math.abs(s.speed);
    // The direction only changes at a standstill.
    if (v < 0.3 && target !== 0) s.reverse = target < 0;
    const wanted = Math.sign(target) === (s.reverse ? -1 : 1) ? Math.abs(target) : 0;

    // Driver: hold-speed feed-forward plus a proportional term, pedals moved at a human rate.
    const drag = v > 0.1 ? 0.5 + 0.002 * v * v : 0;
    const err = wanted - v;
    const throttle = err > -2 && wanted > 0 ? clamp(drag / 0.18 + err * 8, 0, s.reverse ? 25 : 100) : 0;
    const brake = Math.max(err < -1 ? clamp((-err - 1) * 10, 0, 100) : 0, wanted === 0 && v > 0.3 ? 30 : 0);
    s.throttle = approach(s.throttle, throttle, 250 * dt);
    s.brake = approach(s.brake, brake, 400 * dt);

    // km/h per s: full throttle is 0-80 in about 6 s, top speed about 93.
    const accel = s.throttle * 0.18 - drag - s.brake * 0.4;
    const next = Math.max(0, v + accel * dt);
    s.speed = s.reverse ? -next : next;

    const draw = s.throttle * 1.6;
    const regen = s.brake * 0.6 * Math.min(1, next / 20);
    s.current = regen - draw - 1.5;
    s.soc += (s.current * dt * 100) / 3600 / CAPACITY_AH;
    // ponytail: a "charged" pack after every few laps, so the low-SoC states show up during a dev session.
    if (s.soc < 12) s.soc = 90;

    const i2 = s.current * s.current;
    s.motorTemp += (0.00004 * i2 - (s.motorTemp - AMBIENT_C) / 90) * dt;
    s.escTemp += (0.00003 * i2 - (s.escTemp - AMBIENT_C) / 60) * dt;
    s.packTemp += (0.000005 * i2 - (s.packTemp - AMBIENT_C) / 600) * dt;
}

const voltage = (s: Sim) => BATTERY_MIN_VOLTAGE + ((BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE) * s.soc) / 100 + s.current * PACK_OHM;

const byte = (v: number) => clamp(Math.round(v), 0, 255);

const float = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    return b;
};

/** zc_motor telemetry, 23 bytes (layout: sero.ts motorEvent). */
function motorPayload(s: Sim, relays: [number, number]): Buffer {
    const p = Buffer.alloc(23);
    const rpm = Math.abs(s.speed) / KMH_PER_RPM;
    const inCorner = s.t >= CORNER[0] && s.t < CORNER[1];
    const switches = (s.brake > 0 ? 1 : 0) | (s.throttle > 0 ? 2 : 0) | (s.reverse ? 8 | 16 | 32 : 4);
    for (const [o, spread, temp] of [[0, inCorner ? 1.03 : 1, 0], [8, inCorner ? 0.97 : 1, 0.7]]) {
        p.writeUInt16BE(clamp(Math.round(rpm * spread), 0, 0xffff), o);
        p[o + 2] = byte(s.throttle * 2.55);
        p[o + 3] = byte(s.brake * 2.55);
        p[o + 4] = switches;
        p[o + 5] = byte(voltage(s));
        p[o + 6] = byte(s.motorTemp + temp);
        p[o + 7] = byte(s.escTemp + temp);
    }
    p[16] = relays[0];
    p[17] = relays[1];
    p[18] = s.reverse ? 1 : 0;
    p.writeUInt16BE(Math.round(Math.abs(s.current) * 4), 19);
    p.writeUInt16BE(Math.round(Math.abs(s.current) * 4), 21);
    return p;
}

export class MockRuntime implements Runtime {
    private sim = initialSim();
    private last: number | null = null;
    private sinceTemps = TEMPS_EVERY_S;
    private handlers = new Map<string, EventHandler>();
    /** Last lights payload per event, so lights are sent on change like zc_lights does. */
    private sentLights = new Map<number, string>();
    private found: ((serviceId: number, address: Address) => void) | null = null;
    private relays: [number, number] = [1, 1];
    /** Lights the user toggled; the turn signals also follow the driver. */
    private user = { drl: 1, tail: 1, highBeam: 0, hazard: 0, turnLeft: 0, turnRight: 0 };

    process(nowMs = Date.now()): void {
        if (this.last !== null && nowMs - this.last < 100) return;
        const dt = this.last === null ? 0 : (nowMs - this.last) / 1000;
        this.last = nowMs;
        step(this.sim, dt);
        const s = this.sim;

        this.emit(SERVICE.MOTOR, EVENT.motor.TELEMETRY, motorPayload(s, this.relays));
        this.emit(SERVICE.BATTERY, EVENT.battery.VOLTAGE, float(voltage(s)));
        this.emit(SERVICE.BATTERY, EVENT.battery.CURRENT, float(s.current));
        this.sinceTemps += dt;
        if (this.sinceTemps >= TEMPS_EVERY_S) {
            this.sinceTemps = 0;
            this.emit(SERVICE.BATTERY, EVENT.battery.TEMPS, Buffer.concat(CELL_OFFSETS.map((o) => float(s.packTemp + o))));
        }

        const blink = Math.floor(nowMs / BLINK_MS) % 2;
        const signal = SIGNALS.find(([from, to]) => s.t >= from && s.t < to)?.[2];
        const left = this.user.hazard || this.user.turnLeft || signal === "left" ? blink : 0;
        const right = this.user.hazard || this.user.turnRight || signal === "right" ? blink : 0;
        this.light(EVENT.lights.TURN, [left, right]);
        this.light(EVENT.lights.HIGH_BEAM, [this.user.highBeam, this.user.highBeam]);
        this.light(EVENT.lights.BRAKE, [s.brake > 5 ? 1 : 0]);
        this.light(EVENT.lights.REVERSE, [s.reverse ? 1 : 0]);
        this.light(EVENT.lights.DRL, [this.user.drl]);
        this.light(EVENT.lights.TAIL, [this.user.tail]);
    }

    private emit(service: number, event: number, payload: Buffer): void {
        this.handlers.get(`${service}:${event}`)?.(service, event, payload);
    }

    private light(event: number, payload: number[]): void {
        if (!this.handlers.has(`${SERVICE.LIGHTS}:${event}`)) return;
        const key = payload.join();
        if (this.sentLights.get(event) === key) return;
        this.sentLights.set(event, key);
        this.emit(SERVICE.LIGHTS, event, Buffer.from(payload));
    }

    destroy(): void {
        this.handlers.clear();
    }

    getLocalAddress(): Address {
        return { ip: "127.0.0.1", port: 0 };
    }

    onServiceFound(callback: (serviceId: number, address: Address) => void): void {
        this.found = callback;
    }

    onServiceLost(): void {}

    onSubscriptionAck(): void {}

    /** Every zone controller is "found" right away. */
    findService(serviceId: number): boolean {
        this.found?.(serviceId, { ip: "127.0.0.1", port: 0 });
        return true;
    }

    subscribeEvent(serviceId: number, eventId: number, handler: EventHandler): boolean {
        this.handlers.set(`${serviceId}:${eventId}`, handler);
        return true;
    }

    fireAndForget(serviceId: number, methodId: number): boolean {
        if (serviceId !== SERVICE.LIGHTS) return true;
        const u = this.user;
        const flip = (v: number) => (v ? 0 : 1);
        if (methodId === METHOD.lights.TURN_LEFT) [u.turnLeft, u.turnRight] = [flip(u.turnLeft), 0];
        else if (methodId === METHOD.lights.TURN_RIGHT) [u.turnLeft, u.turnRight] = [0, flip(u.turnRight)];
        else if (methodId === METHOD.lights.HAZARD) u.hazard = flip(u.hazard);
        else if (methodId === METHOD.lights.HIGH_BEAM) u.highBeam = flip(u.highBeam);
        else if (methodId === METHOD.lights.DRL) u.drl = flip(u.drl);
        else if (methodId === METHOD.lights.TAIL) u.tail = flip(u.tail);
        return true;
    }

    /** Relay toggles succeed; anything else (e.g. an OTA trigger) is refused with E_NOT_OK. */
    async request(serviceId: number, methodId: number, payload?: Buffer): Promise<RequestResult> {
        const relay = payload?.[0];
        if (serviceId === SERVICE.MOTOR && methodId === METHOD.motor.TOGGLE_RELAY && (relay === 0 || relay === 1)) {
            this.relays[relay] = this.relays[relay] ? 0 : 1;
            return { returnCode: 0, payload: Buffer.alloc(0) };
        }
        return { returnCode: 1, payload: Buffer.alloc(0) };
    }
}
