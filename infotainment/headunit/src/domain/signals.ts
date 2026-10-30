import type { EcuId } from "@/data/ecu/ecu-types";

/*
 * Telemetry signals as the headunit sees them. Names are the catalog names
 * (analytics/schema/signals.yaml) so a kart-agent adapter maps 1:1; the few names
 * not in the catalog are derived on the headunit and marked below.
 * Every value is a number: booleans are 0/1, enums are their numeric value (catalog rule).
 *
 * ponytail: hand-written mirror of signals.yaml, codegen when the catalog changes often enough to drift.
 */

/** Signals the motor ECU sends periodically (10 Hz); stale after this long without a sample. */
const MOTOR_TIMEOUT_MS = 1000;
/** Battery temperatures arrive at 0.5 Hz. */
const TEMP_TIMEOUT_MS = 6000;
/** GPS epochs arrive at 1-5 Hz; kart-agent itself calls the receiver stale after 3 s. */
const GPS_TIMEOUT_MS = 3000;

interface SignalMeta {
    /**
     * The zone controller that measures the signal; the Sero adapter writes these. Unset for signals that come
     * from kart-agent's stream (main/adapters/kart-agent.ts), so every signal has one writer (ADR-0002).
     */
    ecu?: EcuId;
    /** Stale after this long without a sample. Unset for signals sent on change: stale only when the ECU is lost. */
    timeoutMs?: number;
}

const motor = { ecu: "zc_motor", timeoutMs: MOTOR_TIMEOUT_MS } as const;
const temps = { ecu: "zc_battery", timeoutMs: TEMP_TIMEOUT_MS } as const;
const battery = { ecu: "zc_battery" } as const;
const lights = { ecu: "zc_lights" } as const;
const gps = { timeoutMs: GPS_TIMEOUT_MS } as const;

export const SIGNALS = {
    // --- battery (zc_battery, voltage/current sent on change) ---
    "battery.voltage": battery,
    "battery.current": battery,
    "battery.power": battery,
    "battery.soc": battery,
    /** Hottest valid sensor (catalog). */
    "battery.temp": temps,
    "battery.temp_1": temps,
    "battery.temp_2": temps,
    "battery.temp_3": temps,
    "battery.temp_4": temps,
    "battery.temp_5": temps,
    "battery.temp_6": temps,
    "battery.temp_7": temps,
    "battery.temp_8": temps,
    "battery.temp_9": temps,
    "battery.temp_10": temps,
    /** Headunit-derived: coldest valid sensor. */
    "battery.temp_min": temps,
    /** Headunit-derived: mean of valid sensors. */
    "battery.temp_avg": temps,
    "battery.voltage_ctrl_left": motor,
    "battery.voltage_ctrl_right": motor,

    // --- drive (zc_motor, 10 Hz) ---
    "drive.throttle": motor,
    "drive.rpm_left": motor,
    "drive.rpm_right": motor,
    "drive.speed": motor,
    "drive.reverse": motor,
    "drive.throttle_raw_left": motor,
    "drive.throttle_raw_right": motor,
    "drive.brake_raw_left": motor,
    "drive.brake_raw_right": motor,
    "drive.brake_switch_left": motor,
    "drive.foot_switch_left": motor,
    "drive.forward_switch_left": motor,
    "drive.reverse_switch_left": motor,
    "drive.setting_dir_left": motor,
    "drive.actual_dir_left": motor,
    "drive.brake_switch_right": motor,
    "drive.foot_switch_right": motor,
    "drive.forward_switch_right": motor,
    "drive.reverse_switch_right": motor,
    "drive.setting_dir_right": motor,
    "drive.actual_dir_right": motor,
    "drive.relay_1": motor,
    "drive.relay_2": motor,
    "drive.phase_current_raw_left": motor,
    "drive.phase_current_raw_right": motor,
    /** Headunit-derived: FlowState from battery current. */
    "drive.flow_state": battery,

    // --- temperatures (zc_motor, Kelly controllers) ---
    "temp.motor_left": motor,
    "temp.motor_right": motor,
    "temp.esc_left": motor,
    "temp.esc_right": motor,

    // --- lights (zc_lights, sent on change) ---
    "lights.turn_left": lights,
    "lights.turn_right": lights,
    "lights.high_beam_left": lights,
    "lights.high_beam_right": lights,
    "lights.brake": lights,
    "lights.reverse": lights,
    "lights.drl": lights,
    "lights.tail": lights,
    /** Headunit-derived: hazard mode, held through the blink-off phase. */
    "lights.hazard": lights,

    // --- GPS (kart-agent, u-blox receiver on the Pi) ---
    // Position, altitude and HDOP only arrive with a fix, heading only above 3 km/h: they go stale when the
    // kart loses the fix or stops. Use useSample where a held value makes sense (e.g. the heading on a map).
    "gps.lat": gps,
    "gps.lon": gps,
    "gps.heading": gps,
    /** km/h over ground. */
    "gps.speed": gps,
    "gps.altitude": gps,
    /** 0 = none, 2 = 2D, 3 = 3D, 4 = 3D + SBAS/DGPS. */
    "gps.fix": gps,
    "gps.satellites": gps,
    "gps.hdop": gps,
} satisfies Record<string, SignalMeta>;

export type SignalName = keyof typeof SIGNALS;

export const SIGNAL_NAMES = Object.keys(SIGNALS) as SignalName[];

export const signalMeta = (name: SignalName): SignalMeta => SIGNALS[name];

/** One received value. `stale` is set when the ECU went away or the signal timed out. */
export interface Sample {
    value: number;
    /** Epoch ms when main received it. */
    ts: number;
    stale: boolean;
}

/**
 * What main pushes on `signals:batch` and returns from `signals:snapshot`: the signals that changed,
 * `null` for a signal that has no valid value any more (e.g. every temperature sensor invalid).
 */
export type SignalBatch = Partial<Record<SignalName, Sample | null>>;

/** Value of `drive.flow_state`. */
export enum FlowState {
    IDLE = 0,
    POWER = 1,
    REGEN = 2,
}
