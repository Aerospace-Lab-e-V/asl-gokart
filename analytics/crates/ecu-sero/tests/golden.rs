//! Golden payloads written from the firmware sources, so a layout change on either
//! side shows up here.

use std::collections::BTreeSet;

use ecu_sero::{
    BatteryEvent, Decoder, EcuEvent, KellyBlock, LightsEvent, MotorEvent, Switches, decode, encode,
    ids,
};
use telemetry_schema::{ids as sig, v1::Sample};

fn hex(s: &str) -> Vec<u8> {
    s.split_whitespace()
        .map(|b| u8::from_str_radix(b, 16).unwrap())
        .collect()
}

/// `zc_motor/src/main.cpp`, `loop()`: per controller rpm (u16 BE), throttle, brake,
/// switches, battery voltage, motor temp, controller temp; then relay 1, relay 2, reverse.
const MOTOR_19: &str = "01 F4 80 00 06 3C 28 23  01 FE 7F 00 06 3B 29 24  01 00 00";

fn motor_event() -> MotorEvent {
    MotorEvent {
        left: KellyBlock {
            rpm: 500,
            throttle: 0x80,
            brake: 0,
            switches: Switches(Switches::FOOT | Switches::FORWARD),
            battery_voltage: 60,
            motor_temp: 40,
            controller_temp: 35,
        },
        right: KellyBlock {
            rpm: 510,
            throttle: 0x7F,
            brake: 0,
            switches: Switches(Switches::FOOT | Switches::FORWARD),
            battery_voltage: 59,
            motor_temp: 41,
            controller_temp: 36,
        },
        relays: [true, false],
        reverse: false,
        phase_current: None,
    }
}

#[test]
fn motor_19_bytes() {
    let event = decode(ids::MOTOR, ids::motor::TELEMETRY, &hex(MOTOR_19)).unwrap();
    assert_eq!(event, Some(EcuEvent::Motor(motor_event())));
}

#[test]
fn motor_23_bytes_with_phase_current() {
    // `feature/zc_logging`: phase current left/right (u16 BE) appended.
    let payload = hex(&format!("{MOTOR_19} 00 7B 01 C8"));
    let Some(EcuEvent::Motor(m)) = decode(ids::MOTOR, ids::motor::TELEMETRY, &payload).unwrap()
    else {
        panic!("not a motor event");
    };
    assert_eq!(m.phase_current, Some([123, 456]));
}

#[test]
fn motor_too_short_is_an_error() {
    let payload = hex(MOTOR_19);
    let err = decode(ids::MOTOR, ids::motor::TELEMETRY, &payload[..16]).unwrap_err();
    assert_eq!(err.len, 16);
}

#[test]
fn battery_floats_are_little_endian() {
    // `zc_battery/src/main.cpp` copies the raw `float` bytes (ESP32 is little-endian).
    let v = decode(ids::BATTERY, ids::battery::VOLTAGE, &hex("00 00 42 42")).unwrap();
    assert_eq!(v, Some(EcuEvent::Battery(BatteryEvent::Voltage(48.5))));

    let t = decode(
        ids::BATTERY,
        ids::battery::TEMPS,
        &hex("00 00 C8 41 00 00 FE C2"),
    )
    .unwrap();
    assert_eq!(
        t,
        Some(EcuEvent::Battery(BatteryEvent::Temps(vec![25.0, -127.0])))
    );

    assert!(decode(ids::BATTERY, ids::battery::CURRENT, &hex("00 00 42")).is_err());
    assert!(decode(ids::BATTERY, ids::battery::TEMPS, &hex("00 00 C8 41 00")).is_err());
    assert!(decode(ids::BATTERY, ids::battery::TEMPS, &[]).is_err());
}

#[test]
fn lights() {
    // `zc_lights/src/main.cpp`: `[left, right]` for turn and high beam, `[on]` otherwise.
    assert_eq!(
        decode(ids::LIGHTS, ids::lights::TURN, &[1, 0]).unwrap(),
        Some(EcuEvent::Lights(LightsEvent::Turn { left: 1, right: 0 }))
    );
    assert_eq!(
        decode(ids::LIGHTS, ids::lights::TAIL, &[1]).unwrap(),
        Some(EcuEvent::Lights(LightsEvent::Tail(1)))
    );
    assert!(decode(ids::LIGHTS, ids::lights::HIGH_BEAM, &[1]).is_err());
}

#[test]
fn unknown_events_are_ignored() {
    assert_eq!(decode(ids::MOTOR, 0x8099, &[1, 2, 3]).unwrap(), None);
    assert_eq!(decode(0x0042, 0x8001, &[]).unwrap(), None);
}

fn all_events() -> Vec<EcuEvent> {
    vec![
        EcuEvent::Lights(LightsEvent::Turn { left: 1, right: 0 }),
        EcuEvent::Lights(LightsEvent::HighBeam { left: 0, right: 1 }),
        EcuEvent::Lights(LightsEvent::Brake(1)),
        EcuEvent::Lights(LightsEvent::Reverse(0)),
        EcuEvent::Lights(LightsEvent::Drl(1)),
        EcuEvent::Lights(LightsEvent::Tail(1)),
        EcuEvent::Battery(BatteryEvent::Voltage(58.25)),
        EcuEvent::Battery(BatteryEvent::Current(-12.5)),
        EcuEvent::Battery(BatteryEvent::Temps(vec![24.5; 10])),
        EcuEvent::Motor(MotorEvent {
            phase_current: Some([10, 20]),
            ..motor_event()
        }),
    ]
}

#[test]
fn encode_decode_round_trip() {
    for event in all_events() {
        let (service, id, payload) = encode(&event);
        assert_eq!(decode(service, id, &payload).unwrap(), Some(event));
    }
    let (_, _, payload) = encode(&EcuEvent::Motor(motor_event()));
    assert_eq!(payload, hex(MOTOR_19));
}

#[test]
fn subscriptions_cover_every_known_event() {
    for event in all_events() {
        let (service, id, _) = encode(&event);
        assert!(ecu_sero::SUBSCRIPTIONS.contains(&(service, id)));
    }
}

fn samples(events: &[EcuEvent]) -> Vec<Sample> {
    let mut decoder = Decoder::default();
    let mut out = Vec::new();
    for (i, e) in events.iter().enumerate() {
        decoder.push(e, 1_000 + i as i64, &mut out);
    }
    out
}

#[test]
fn every_sero_catalog_signal_is_produced() {
    let produced: BTreeSet<u32> = samples(&all_events()).iter().map(|s| s.signal_id).collect();
    // Catalog signals of the Sero ECUs that no firmware sends yet.
    let no_source = [sig::BATTERY_SOC];
    let expected: BTreeSet<u32> = telemetry_schema::signals()
        .iter()
        .filter(|s| ["battery", "motor", "lights"].contains(&s.ecu.as_str()))
        .filter(|s| !s.deprecated && !no_source.contains(&s.id))
        .map(|s| s.id)
        .collect();
    assert_eq!(produced, expected);
}

#[test]
fn derived_signals() {
    let value = |out: &[Sample], id| out.iter().find(|s| s.signal_id == id).map(|s| s.value);

    let out = samples(&[EcuEvent::Motor(motor_event())]);
    // max(0x80, 0x7F) / 255
    assert!((value(&out, sig::DRIVE_THROTTLE).unwrap() - 50.196).abs() < 0.01);
    // 505 rpm / 60 × 1.415 m × 3.6
    assert!((value(&out, sig::DRIVE_SPEED).unwrap() - 42.88).abs() < 0.01);
    assert_eq!(value(&out, sig::DRIVE_FOOT_SWITCH_LEFT), Some(1.0));
    assert_eq!(value(&out, sig::DRIVE_BRAKE_SWITCH_LEFT), Some(0.0));
    assert_eq!(value(&out, sig::DRIVE_PHASE_CURRENT_RAW_LEFT), None);

    let out = samples(&[
        EcuEvent::Battery(BatteryEvent::Voltage(60.0)),
        EcuEvent::Battery(BatteryEvent::Current(50.0)),
    ]);
    assert_eq!(value(&out, sig::BATTERY_POWER), Some(3.0));

    let out = samples(&[EcuEvent::Battery(BatteryEvent::Temps(vec![
        25.0, -127.0, 31.5,
    ]))]);
    assert_eq!(value(&out, sig::BATTERY_TEMP), Some(31.5));
    assert_eq!(value(&out, sig::BATTERY_TEMP_2), None);
    assert_eq!(value(&out, sig::BATTERY_TEMP_3), Some(31.5));
}

#[test]
fn power_needs_a_recent_partner_value() {
    let mut decoder = Decoder::default();
    let mut out = Vec::new();
    decoder.push(&EcuEvent::Battery(BatteryEvent::Voltage(60.0)), 0, &mut out);
    decoder.push(
        &EcuEvent::Battery(BatteryEvent::Current(10.0)),
        6_000_000,
        &mut out,
    );
    assert!(!out.iter().any(|s| s.signal_id == sig::BATTERY_POWER));
}
