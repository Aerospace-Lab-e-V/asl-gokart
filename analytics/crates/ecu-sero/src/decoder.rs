use telemetry_schema::{ids, v1::Sample};

use crate::{
    BatteryEvent, EcuEvent, INVALID_TEMP_C, KellyBlock, LightsEvent, MotorEvent, Switches,
};

/// Wheel circumference in metres. The motors drive the wheels directly, so motor rpm
/// is wheel rpm (same assumption as the headunit, `src/stores/motorSlice.ts`).
pub const WHEEL_CIRCUMFERENCE_M: f64 = 1.415;

/// Voltage and current arrive separately and only on change, so the last value of
/// each stays valid; past this age it is treated as gone (ECU silent).
const HOLD_US: i64 = 5_000_000;

const BATTERY_TEMPS: [u32; crate::MAX_TEMP_SENSORS] = [
    ids::BATTERY_TEMP_1,
    ids::BATTERY_TEMP_2,
    ids::BATTERY_TEMP_3,
    ids::BATTERY_TEMP_4,
    ids::BATTERY_TEMP_5,
    ids::BATTERY_TEMP_6,
    ids::BATTERY_TEMP_7,
    ids::BATTERY_TEMP_8,
    ids::BATTERY_TEMP_9,
    ids::BATTERY_TEMP_10,
];

/// Turns ECU events into catalog samples, including the signals derived on the kart.
pub struct Decoder {
    wheel_circumference_m: f64,
    voltage: Option<(i64, f32)>,
    current: Option<(i64, f32)>,
}

impl Default for Decoder {
    fn default() -> Self {
        Self::new(WHEEL_CIRCUMFERENCE_M)
    }
}

impl Decoder {
    pub fn new(wheel_circumference_m: f64) -> Self {
        Self {
            wheel_circumference_m,
            voltage: None,
            current: None,
        }
    }

    /// Forgets held values, e.g. when the battery ECU went away.
    pub fn reset(&mut self) {
        self.voltage = None;
        self.current = None;
    }

    /// Appends the samples for one event, all stamped `t_us`.
    pub fn push(&mut self, event: &EcuEvent, t_us: i64, out: &mut Vec<Sample>) {
        let mut put = |signal_id, value: f64| {
            out.push(Sample {
                signal_id,
                t_us,
                value,
            })
        };
        match event {
            EcuEvent::Lights(e) => match *e {
                LightsEvent::Turn { left, right } => {
                    put(ids::LIGHTS_TURN_LEFT, on(left));
                    put(ids::LIGHTS_TURN_RIGHT, on(right));
                }
                LightsEvent::HighBeam { left, right } => {
                    put(ids::LIGHTS_HIGH_BEAM_LEFT, on(left));
                    put(ids::LIGHTS_HIGH_BEAM_RIGHT, on(right));
                }
                LightsEvent::Brake(v) => put(ids::LIGHTS_BRAKE, on(v)),
                LightsEvent::Reverse(v) => put(ids::LIGHTS_REVERSE, on(v)),
                LightsEvent::Drl(v) => put(ids::LIGHTS_DRL, on(v)),
                LightsEvent::Tail(v) => put(ids::LIGHTS_TAIL, on(v)),
            },
            EcuEvent::Battery(BatteryEvent::Voltage(v)) => {
                put(ids::BATTERY_VOLTAGE, *v as f64);
                self.voltage = Some((t_us, *v));
                if let Some(kw) = self.power_kw(t_us) {
                    put(ids::BATTERY_POWER, kw);
                }
            }
            EcuEvent::Battery(BatteryEvent::Current(c)) => {
                put(ids::BATTERY_CURRENT, *c as f64);
                self.current = Some((t_us, *c));
                if let Some(kw) = self.power_kw(t_us) {
                    put(ids::BATTERY_POWER, kw);
                }
            }
            EcuEvent::Battery(BatteryEvent::Temps(temps)) => {
                let mut hottest: Option<f32> = None;
                for (&id, &t) in BATTERY_TEMPS.iter().zip(temps) {
                    if t == INVALID_TEMP_C || !t.is_finite() {
                        continue;
                    }
                    put(id, t as f64);
                    hottest = Some(hottest.map_or(t, |h| h.max(t)));
                }
                if let Some(h) = hottest {
                    put(ids::BATTERY_TEMP, h as f64);
                }
            }
            EcuEvent::Motor(m) => self.push_motor(m, &mut put),
        }
    }

    fn push_motor(&self, m: &MotorEvent, put: &mut impl FnMut(u32, f64)) {
        let sides = [
            (
                &m.left,
                [
                    ids::DRIVE_RPM_LEFT,
                    ids::DRIVE_THROTTLE_RAW_LEFT,
                    ids::DRIVE_BRAKE_RAW_LEFT,
                    ids::BATTERY_VOLTAGE_CTRL_LEFT,
                    ids::TEMP_MOTOR_LEFT,
                    ids::TEMP_ESC_LEFT,
                ],
                [
                    ids::DRIVE_BRAKE_SWITCH_LEFT,
                    ids::DRIVE_FOOT_SWITCH_LEFT,
                    ids::DRIVE_FORWARD_SWITCH_LEFT,
                    ids::DRIVE_REVERSE_SWITCH_LEFT,
                    ids::DRIVE_SETTING_DIR_LEFT,
                    ids::DRIVE_ACTUAL_DIR_LEFT,
                ],
            ),
            (
                &m.right,
                [
                    ids::DRIVE_RPM_RIGHT,
                    ids::DRIVE_THROTTLE_RAW_RIGHT,
                    ids::DRIVE_BRAKE_RAW_RIGHT,
                    ids::BATTERY_VOLTAGE_CTRL_RIGHT,
                    ids::TEMP_MOTOR_RIGHT,
                    ids::TEMP_ESC_RIGHT,
                ],
                [
                    ids::DRIVE_BRAKE_SWITCH_RIGHT,
                    ids::DRIVE_FOOT_SWITCH_RIGHT,
                    ids::DRIVE_FORWARD_SWITCH_RIGHT,
                    ids::DRIVE_REVERSE_SWITCH_RIGHT,
                    ids::DRIVE_SETTING_DIR_RIGHT,
                    ids::DRIVE_ACTUAL_DIR_RIGHT,
                ],
            ),
        ];
        for (k, values, switches) in sides {
            let KellyBlock {
                rpm,
                throttle,
                brake,
                switches: bits,
                battery_voltage,
                motor_temp,
                controller_temp,
            } = *k;
            let [
                rpm_id,
                throttle_id,
                brake_id,
                voltage_id,
                motor_temp_id,
                ctrl_temp_id,
            ] = values;
            put(rpm_id, rpm as f64);
            put(throttle_id, throttle as f64);
            put(brake_id, brake as f64);
            put(voltage_id, battery_voltage as f64);
            put(motor_temp_id, motor_temp as f64);
            put(ctrl_temp_id, controller_temp as f64);
            let flags = [
                Switches::BRAKE,
                Switches::FOOT,
                Switches::FORWARD,
                Switches::REVERSE,
                Switches::SETTING_DIR,
                Switches::ACTUAL_DIR,
            ];
            for (id, bit) in switches.into_iter().zip(flags) {
                put(id, on(bits.get(bit) as u8));
            }
        }
        put(ids::DRIVE_RELAY_1, on(m.relays[0] as u8));
        put(ids::DRIVE_RELAY_2, on(m.relays[1] as u8));
        put(ids::DRIVE_REVERSE, on(m.reverse as u8));
        if let Some([left, right]) = m.phase_current {
            put(ids::DRIVE_PHASE_CURRENT_RAW_LEFT, left as f64);
            put(ids::DRIVE_PHASE_CURRENT_RAW_RIGHT, right as f64);
        }

        // A controller that stops answering reports zeros, so the higher reading is
        // the more trustworthy pedal position.
        let throttle_raw = m.left.throttle.max(m.right.throttle);
        put(ids::DRIVE_THROTTLE, throttle_raw as f64 / 255.0 * 100.0);
        let mean_rpm = (m.left.rpm as f64 + m.right.rpm as f64) / 2.0;
        put(
            ids::DRIVE_SPEED,
            mean_rpm / 60.0 * self.wheel_circumference_m * 3.6,
        );
    }

    fn power_kw(&self, now_us: i64) -> Option<f64> {
        let fresh = |held: Option<(i64, f32)>| {
            held.filter(|(t, _)| now_us - t <= HOLD_US)
                .map(|(_, v)| v as f64)
        };
        Some(fresh(self.voltage)? * fresh(self.current)? / 1000.0)
    }
}

fn on(v: u8) -> f64 {
    if v != 0 { 1.0 } else { 0.0 }
}
