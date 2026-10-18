//! `--output sero`: the sim plays the zone controllers and sends their Sero events,
//! with the firmware's layouts (`ecu-sero`) and timing, so kart-agent and the
//! headunit run against the real protocol without hardware.
//!
//! Each ECU is its own sero runtime (own client id and port, as on the kart).

use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use ecu_sero::{
    BatteryEvent, EcuEvent, KellyBlock, LightsEvent, MotorEvent, Switches, encode, ids,
};
use sero_sys::{Command, Event, Handler, LogLevel, Options, net};
use tokio::time::MissedTickBehavior;
use tracing::{info, warn};

use crate::{Args, STEP_US, physics::Kart};

/// Service ids and the events each simulated ECU offers.
const ECUS: [(u16, &[u16]); 3] = [
    (
        ids::LIGHTS,
        &[
            ids::lights::TURN,
            ids::lights::HIGH_BEAM,
            ids::lights::BRAKE,
            ids::lights::REVERSE,
            ids::lights::DRL,
            ids::lights::TAIL,
        ],
    ),
    (
        ids::BATTERY,
        &[
            ids::battery::VOLTAGE,
            ids::battery::CURRENT,
            ids::battery::TEMPS,
        ],
    ),
    (ids::MOTOR, &[ids::motor::TELEMETRY]),
];

/// Firmware timing (`zc_motor`, `zc_battery`).
const MOTOR_PERIOD_US: i64 = 100_000;
const BMS_POLL_US: i64 = 100_000;
const TEMPS_PERIOD_US: i64 = 2_000_000;
/// The lights firmware only sends changes. The sim also repeats the full state this
/// often, so a consumer that subscribes late still learns it.
const LIGHTS_REPEAT_US: i64 = 5_000_000;

struct LogWarnings(u16);

impl Handler for LogWarnings {
    fn on_event(&mut self, event: Event) {
        match event {
            Event::Log(l) if l.level >= LogLevel::Warn => {
                warn!(service = format!("0x{:04X}", self.0), tag = %l.tag, "sero");
            }
            Event::CommandFailed { command, .. } => warn!(command, "sero command failed"),
            _ => {}
        }
    }
}

pub async fn run(args: &Args, mut kart: Kart) -> Result<()> {
    let interface = args
        .sero_interface
        .as_deref()
        .context("--output sero needs --sero-interface")?;
    let ip = net::interface_ipv4(interface)?
        .with_context(|| format!("{interface} has no IPv4 address or is down"))?;

    let mut ecus = Vec::new();
    for (service, events) in ECUS {
        let opts = Options::new(ip, args.sero_base_port + service, 0x0F00 + service);
        let thread = sero_sys::spawn(opts, Box::new(LogWarnings(service)), move |rt, now| {
            let ok = rt.register_service(service, 1, 0)
                && events.iter().all(|&e| rt.register_event(service, e))
                && rt.offer(service, 10, now);
            ok.then_some(())
                .ok_or_else(|| std::io::Error::other("registering the service failed"))
        })
        .with_context(|| format!("starting ECU 0x{service:04X}"))?;
        info!(service = format!("0x{service:04X}"), addr = %thread.local_addr(), "offering");
        ecus.push((service, thread));
    }
    let send = |event: &EcuEvent| {
        let (service, event, payload) = encode(event);
        let (_, thread) = ecus
            .iter()
            .find(|(s, _)| *s == service)
            .expect("every encoded service is simulated");
        thread.send(Command::Notify {
            service,
            event,
            payload,
        });
    };

    let start = Instant::now();
    let deadline = args.duration.map(|d| start + Duration::from_secs(d));
    let mut sim_us: i64 = 0;
    let mut last_battery: (f32, f32) = (f32::NAN, f32::NAN);
    let mut last_lights: Vec<EcuEvent> = Vec::new();
    let mut lights_sent_us = -LIGHTS_REPEAT_US;

    let mut tick = tokio::time::interval(Duration::from_micros(STEP_US as u64));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let shutdown = crate::shutdown_signal();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = &mut shutdown => break,
        }
        if deadline.is_some_and(|d| Instant::now() >= d) {
            break;
        }

        let target_us = start.elapsed().as_micros() as i64;
        while sim_us + STEP_US <= target_us {
            sim_us += STEP_US;
            kart.step(STEP_US as f64 / 1e6);

            if sim_us % MOTOR_PERIOD_US == 0 {
                send(&EcuEvent::Motor(motor_event(&mut kart)));
            }
            if sim_us % BMS_POLL_US == 0 {
                // The BMS reports with 0.1 V / 0.1 A resolution and the firmware only
                // sends changes.
                let v = round1(kart.measure("battery.voltage").unwrap_or_default());
                let c = round1(kart.measure("battery.current").unwrap_or_default());
                if v != last_battery.0 {
                    send(&EcuEvent::Battery(BatteryEvent::Voltage(v)));
                }
                if c != last_battery.1 {
                    send(&EcuEvent::Battery(BatteryEvent::Current(c)));
                }
                last_battery = (v, c);
            }
            if sim_us % TEMPS_PERIOD_US == 0 {
                let temps = (1..=args.battery_temp_sensors)
                    .map(|n| {
                        kart.measure(&format!("battery.temp_{n}"))
                            .unwrap_or_default() as f32
                    })
                    .collect();
                send(&EcuEvent::Battery(BatteryEvent::Temps(temps)));
            }

            let lights = lights_events(&mut kart);
            let repeat = sim_us - lights_sent_us >= LIGHTS_REPEAT_US;
            for (i, e) in lights.iter().enumerate() {
                if repeat || last_lights.get(i) != Some(e) {
                    send(e);
                }
            }
            if repeat {
                lights_sent_us = sim_us;
            }
            last_lights = lights;
        }
    }

    info!(laps = kart.laps, "stopping");
    for (_, thread) in ecus {
        thread.shutdown();
    }
    Ok(())
}

fn measure_u8(kart: &mut Kart, signal: &str) -> u8 {
    kart.measure(signal)
        .unwrap_or_default()
        .round()
        .clamp(0.0, u8::MAX as f64) as u8
}

fn motor_event(kart: &mut Kart) -> MotorEvent {
    let mut block = |side: &str| {
        let mut switches = 0;
        for (bit, name) in [
            (Switches::BRAKE, "brake_switch"),
            (Switches::FOOT, "foot_switch"),
            (Switches::FORWARD, "forward_switch"),
            (Switches::REVERSE, "reverse_switch"),
            (Switches::SETTING_DIR, "setting_dir"),
            (Switches::ACTUAL_DIR, "actual_dir"),
        ] {
            if measure_u8(kart, &format!("drive.{name}_{side}")) != 0 {
                switches |= bit;
            }
        }
        KellyBlock {
            rpm: kart
                .measure(&format!("drive.rpm_{side}"))
                .unwrap_or_default()
                .round()
                .clamp(0.0, u16::MAX as f64) as u16,
            throttle: measure_u8(kart, &format!("drive.throttle_raw_{side}")),
            brake: measure_u8(kart, &format!("drive.brake_raw_{side}")),
            switches: Switches(switches),
            battery_voltage: measure_u8(kart, &format!("battery.voltage_ctrl_{side}")),
            motor_temp: measure_u8(kart, &format!("temp.motor_{side}")),
            controller_temp: measure_u8(kart, &format!("temp.esc_{side}")),
        }
    };
    let (left, right) = (block("left"), block("right"));
    MotorEvent {
        left,
        right,
        relays: [
            measure_u8(kart, "drive.relay_1") != 0,
            measure_u8(kart, "drive.relay_2") != 0,
        ],
        reverse: measure_u8(kart, "drive.reverse") != 0,
        // Phase currents only exist in the zc_logging firmware's 23-byte event.
        phase_current: None,
    }
}

fn lights_events(kart: &mut Kart) -> Vec<EcuEvent> {
    let mut m = |name| measure_u8(kart, name);
    vec![
        EcuEvent::Lights(LightsEvent::Turn {
            left: m("lights.turn_left"),
            right: m("lights.turn_right"),
        }),
        EcuEvent::Lights(LightsEvent::HighBeam {
            left: m("lights.high_beam_left"),
            right: m("lights.high_beam_right"),
        }),
        EcuEvent::Lights(LightsEvent::Brake(m("lights.brake"))),
        EcuEvent::Lights(LightsEvent::Reverse(m("lights.reverse"))),
        EcuEvent::Lights(LightsEvent::Drl(m("lights.drl"))),
        EcuEvent::Lights(LightsEvent::Tail(m("lights.tail"))),
    ]
}

fn round1(v: f64) -> f32 {
    ((v * 10.0).round() / 10.0) as f32
}

#[cfg(test)]
mod tests {
    use ecu_sero::{Decoder, decode};
    use telemetry_schema::ids;

    use super::*;
    use crate::physics::{DriveMode, Track};

    /// What the sim encodes, the agent's decoder reads back as the physics state.
    #[test]
    fn sim_events_decode_to_the_simulated_state() {
        let mut kart = Kart::new(Track::new(48.0, 11.0), DriveMode::Sport, 7);
        for _ in 0..3000 {
            kart.step(0.01);
        }
        let speed_kmh = kart.v_mps * 3.6;
        assert!(speed_kmh > 20.0, "kart should be moving");

        let mut events = vec![EcuEvent::Motor(motor_event(&mut kart))];
        events.extend(lights_events(&mut kart));
        let mut decoder = Decoder::default();
        let mut samples = Vec::new();
        for e in &events {
            let (service, event, payload) = encode(e);
            let decoded = decode(service, event, &payload).unwrap().unwrap();
            decoder.push(&decoded, 0, &mut samples);
        }
        let value = |id| samples.iter().find(|s| s.signal_id == id).unwrap().value;

        assert!((value(ids::DRIVE_SPEED) - speed_kmh).abs() < 1.0);
        assert_eq!(value(ids::LIGHTS_DRL), 1.0);
        assert_eq!(value(ids::DRIVE_FORWARD_SWITCH_LEFT), 1.0);
    }
}
