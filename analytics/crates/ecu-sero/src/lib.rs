//! Sero event payloads of the zone controllers, as sent by the firmware in `zc/zc_*`.
//!
//! This is the one place that knows the byte layouts: kart-agent decodes with it,
//! kart-sim encodes with it, so the two cannot drift apart. The firmware itself is
//! C++; the golden tests in this crate quote it.
//!
//! - [`decode`] / [`encode`]: raw payload ⇄ typed [`EcuEvent`]
//! - [`Decoder`]: typed events → catalog samples, including derived signals

mod decoder;

pub use decoder::{Decoder, WHEEL_CIRCUMFERENCE_M};

/// Service and event ids (`zc/zc_*/src/config.hpp`). Event ids have bit 15 set.
pub mod ids {
    pub const LIGHTS: u16 = 0x0001;
    pub const BATTERY: u16 = 0x0003;
    pub const MOTOR: u16 = 0x0004;

    pub mod lights {
        /// `[left, right]`, the lamps' physical blink state
        pub const TURN: u16 = 0x8001;
        /// `[left, right]`
        pub const HIGH_BEAM: u16 = 0x8003;
        /// `[on]`, likewise for the events below
        pub const BRAKE: u16 = 0x8004;
        pub const REVERSE: u16 = 0x8005;
        pub const DRL: u16 = 0x8006;
        pub const TAIL: u16 = 0x8007;
    }

    pub mod battery {
        /// `f32` little-endian
        pub const VOLTAGE: u16 = 0x8001;
        /// `f32` little-endian
        pub const CURRENT: u16 = 0x8002;
        /// `[f32]` little-endian, one per sensor
        pub const TEMPS: u16 = 0x8003;
    }

    pub mod motor {
        /// Two Kelly controller blocks plus relays and reverse, see [`crate::MotorEvent`]
        pub const TELEMETRY: u16 = 0x8001;
    }
}

/// Services the agent looks for.
pub const SERVICES: &[u16] = &[ids::LIGHTS, ids::BATTERY, ids::MOTOR];

/// Every event the agent subscribes to, as `(service, event)`.
pub const SUBSCRIPTIONS: &[(u16, u16)] = &[
    (ids::LIGHTS, ids::lights::TURN),
    (ids::LIGHTS, ids::lights::HIGH_BEAM),
    (ids::LIGHTS, ids::lights::BRAKE),
    (ids::LIGHTS, ids::lights::REVERSE),
    (ids::LIGHTS, ids::lights::DRL),
    (ids::LIGHTS, ids::lights::TAIL),
    (ids::BATTERY, ids::battery::VOLTAGE),
    (ids::BATTERY, ids::battery::CURRENT),
    (ids::BATTERY, ids::battery::TEMPS),
    (ids::MOTOR, ids::motor::TELEMETRY),
];

/// Temperature the battery firmware sends for a disconnected or faulty sensor
/// (`zc_battery/src/temp_sensor.hpp`).
pub const INVALID_TEMP_C: f32 = -127.0;

/// At most this many pack temperature sensors (`TempSensor::MAX_SENSORS`).
pub const MAX_TEMP_SENSORS: usize = 10;

#[derive(Debug, Clone, PartialEq)]
pub enum EcuEvent {
    Lights(LightsEvent),
    Battery(BatteryEvent),
    Motor(MotorEvent),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LightsEvent {
    Turn { left: u8, right: u8 },
    HighBeam { left: u8, right: u8 },
    Brake(u8),
    Reverse(u8),
    Drl(u8),
    Tail(u8),
}

#[derive(Debug, Clone, PartialEq)]
pub enum BatteryEvent {
    Voltage(f32),
    Current(f32),
    /// One entry per sensor, [`INVALID_TEMP_C`] for a sensor without a reading.
    Temps(Vec<f32>),
}

/// One Kelly controller's share of the motor event (8 bytes).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct KellyBlock {
    pub rpm: u16,
    pub throttle: u8,
    pub brake: u8,
    pub switches: Switches,
    pub battery_voltage: u8,
    pub motor_temp: u8,
    pub controller_temp: u8,
}

/// Bitfield packed by `pack_switches` in `zc_motor/src/main.cpp`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Switches(pub u8);

impl Switches {
    pub const BRAKE: u8 = 1 << 0;
    pub const FOOT: u8 = 1 << 1;
    pub const FORWARD: u8 = 1 << 2;
    pub const REVERSE: u8 = 1 << 3;
    pub const SETTING_DIR: u8 = 1 << 4;
    pub const ACTUAL_DIR: u8 = 1 << 5;

    pub fn get(self, bit: u8) -> bool {
        self.0 & bit != 0
    }
}

/// Motor event: 19 bytes, or 23 with phase currents (firmware on `feature/zc_logging`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MotorEvent {
    pub left: KellyBlock,
    pub right: KellyBlock,
    pub relays: [bool; 2],
    /// Reverse engaged on both controllers.
    pub reverse: bool,
    pub phase_current: Option<[u16; 2]>,
}

impl MotorEvent {
    pub const LEN: usize = 19;
    pub const LEN_WITH_PHASE_CURRENT: usize = 23;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError {
    pub service: u16,
    pub event: u16,
    pub len: usize,
    pub expected: &'static str,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "service 0x{:04X} event 0x{:04X}: {} bytes, expected {}",
            self.service, self.event, self.len, self.expected
        )
    }
}

impl std::error::Error for DecodeError {}

/// Decodes one event payload. `Ok(None)` for events this crate does not know.
pub fn decode(service: u16, event: u16, payload: &[u8]) -> Result<Option<EcuEvent>, DecodeError> {
    let err = |expected| DecodeError {
        service,
        event,
        len: payload.len(),
        expected,
    };
    let byte = |n: usize| payload.get(n).copied();

    let decoded = match (service, event) {
        (ids::LIGHTS, ids::lights::TURN | ids::lights::HIGH_BEAM) => {
            let [left, right] = payload.try_into().map_err(|_| err("2"))?;
            EcuEvent::Lights(if event == ids::lights::TURN {
                LightsEvent::Turn { left, right }
            } else {
                LightsEvent::HighBeam { left, right }
            })
        }
        (ids::LIGHTS, ids::lights::BRAKE) => {
            EcuEvent::Lights(LightsEvent::Brake(byte(0).ok_or_else(|| err("1"))?))
        }
        (ids::LIGHTS, ids::lights::REVERSE) => {
            EcuEvent::Lights(LightsEvent::Reverse(byte(0).ok_or_else(|| err("1"))?))
        }
        (ids::LIGHTS, ids::lights::DRL) => {
            EcuEvent::Lights(LightsEvent::Drl(byte(0).ok_or_else(|| err("1"))?))
        }
        (ids::LIGHTS, ids::lights::TAIL) => {
            EcuEvent::Lights(LightsEvent::Tail(byte(0).ok_or_else(|| err("1"))?))
        }
        (ids::BATTERY, ids::battery::VOLTAGE | ids::battery::CURRENT) => {
            let bytes: [u8; 4] = payload.try_into().map_err(|_| err("4"))?;
            let value = f32::from_le_bytes(bytes);
            EcuEvent::Battery(if event == ids::battery::VOLTAGE {
                BatteryEvent::Voltage(value)
            } else {
                BatteryEvent::Current(value)
            })
        }
        (ids::BATTERY, ids::battery::TEMPS) => {
            if payload.is_empty() || !payload.len().is_multiple_of(4) {
                return Err(err("a non-zero multiple of 4"));
            }
            let temps = payload
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes(c.try_into().expect("chunk of 4")))
                .collect();
            EcuEvent::Battery(BatteryEvent::Temps(temps))
        }
        (ids::MOTOR, ids::motor::TELEMETRY) => {
            if payload.len() < MotorEvent::LEN {
                return Err(err("at least 19"));
            }
            let kelly = |b: &[u8]| KellyBlock {
                rpm: u16::from_be_bytes([b[0], b[1]]),
                throttle: b[2],
                brake: b[3],
                switches: Switches(b[4]),
                battery_voltage: b[5],
                motor_temp: b[6],
                controller_temp: b[7],
            };
            let u16_be = |n: usize| u16::from_be_bytes([payload[n], payload[n + 1]]);
            EcuEvent::Motor(MotorEvent {
                left: kelly(&payload[0..8]),
                right: kelly(&payload[8..16]),
                relays: [payload[16] != 0, payload[17] != 0],
                reverse: payload[18] != 0,
                phase_current: (payload.len() >= MotorEvent::LEN_WITH_PHASE_CURRENT)
                    .then(|| [u16_be(19), u16_be(21)]),
            })
        }
        _ => return Ok(None),
    };
    Ok(Some(decoded))
}

/// Encodes an event as the firmware would. Returns `(service, event, payload)`.
pub fn encode(event: &EcuEvent) -> (u16, u16, Vec<u8>) {
    match event {
        EcuEvent::Lights(e) => {
            let (id, payload) = match *e {
                LightsEvent::Turn { left, right } => (ids::lights::TURN, vec![left, right]),
                LightsEvent::HighBeam { left, right } => {
                    (ids::lights::HIGH_BEAM, vec![left, right])
                }
                LightsEvent::Brake(on) => (ids::lights::BRAKE, vec![on]),
                LightsEvent::Reverse(on) => (ids::lights::REVERSE, vec![on]),
                LightsEvent::Drl(on) => (ids::lights::DRL, vec![on]),
                LightsEvent::Tail(on) => (ids::lights::TAIL, vec![on]),
            };
            (ids::LIGHTS, id, payload)
        }
        EcuEvent::Battery(e) => {
            let (id, payload) = match e {
                BatteryEvent::Voltage(v) => (ids::battery::VOLTAGE, v.to_le_bytes().to_vec()),
                BatteryEvent::Current(c) => (ids::battery::CURRENT, c.to_le_bytes().to_vec()),
                BatteryEvent::Temps(t) => (
                    ids::battery::TEMPS,
                    t.iter().flat_map(|t| t.to_le_bytes()).collect(),
                ),
            };
            (ids::BATTERY, id, payload)
        }
        EcuEvent::Motor(m) => {
            let mut p = Vec::with_capacity(MotorEvent::LEN_WITH_PHASE_CURRENT);
            for k in [m.left, m.right] {
                p.extend(k.rpm.to_be_bytes());
                p.extend([
                    k.throttle,
                    k.brake,
                    k.switches.0,
                    k.battery_voltage,
                    k.motor_temp,
                    k.controller_temp,
                ]);
            }
            p.extend([m.relays[0] as u8, m.relays[1] as u8, m.reverse as u8]);
            if let Some([left, right]) = m.phase_current {
                p.extend(left.to_be_bytes());
                p.extend(right.to_be_bytes());
            }
            (ids::MOTOR, ids::motor::TELEMETRY, p)
        }
    }
}
