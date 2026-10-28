//! `fixtures/status.json` is the contract for `GET /v1/status`: the headunit's
//! Telemetry page parses it in its unit tests. This test fails when the Rust type
//! changes without the fixture; regenerate it with
//!   UPDATE_FIXTURES=1 cargo test -p kart-agent --test status_fixture
//! and update the headunit's schema if needed.

use std::collections::BTreeMap;

use kart_agent::status::{
    AgentStatus, ClockStatus, EventStatus, GpsStatus, LiveStatus, LogStatus, SeroStatus,
    ServiceStatus, SessionStatus, Status,
};

fn sample() -> Status {
    let event = |id, rx| EventStatus {
        id,
        ack: Some(0),
        last_ack_us: Some(1_792_400_000_000_000),
        last_rx_us: Some(1_792_400_001_000_000),
        rx,
        decode_errors: 0,
    };
    Status {
        agent: AgentStatus {
            version: "0.4.27".into(),
            uptime_s: 3600,
            runs: 1,
            restart_pending: false,
        },
        session: SessionStatus {
            id: "01a1513e-1db3-776f-a5e3-e7869a318798".into(),
            boot_id: "b8d9fb1a-468a-440e-8359-a8fa5674c63b".into(),
            next_seq: 72_000,
        },
        clock: ClockStatus {
            synced: true,
            max_error_us: 16_000,
        },
        sero: SeroStatus {
            state: "running".into(),
            error: None,
            interface: "eth0".into(),
            address: Some("192.168.1.100:30492".into()),
            client_id: 16,
            services: vec![
                ServiceStatus {
                    id: 1,
                    name: "lights".into(),
                    found: true,
                    provider: Some("192.168.1.4:30491".into()),
                    events: vec![event(0x8001, 12)],
                },
                ServiceStatus {
                    id: 4,
                    name: "motor".into(),
                    found: false,
                    provider: None,
                    events: vec![EventStatus {
                        id: 0x8001,
                        ..Default::default()
                    }],
                },
            ],
            counters: BTreeMap::from([("crc_errors".into(), 0), ("stale_messages".into(), 3)]),
            rx_queue_full: 0,
        },
        gps: GpsStatus {
            state: "running".into(),
            error: None,
            device: Some(
                "/dev/serial/by-id/usb-u-blox_AG_-_www.u-blox.com_u-blox_6_-_GPS_Receiver-if00"
                    .into(),
            ),
            firmware: Some("UBX-G60xx 00040007, EXT CORE 7.03 (45970) Mar 17 2011 16:26:24".into()),
            configured: true,
            rate_hz: 5,
            fix: 3,
            satellites: 9,
            hdop: Some(0.9),
            last_fix_us: Some(1_792_400_001_400_000),
            epochs: 18_000,
            sentences: 54_006,
            errors: 0,
            rx_queue_full: 0,
        },
        live: LiveStatus {
            enabled: true,
            configured: true,
            broker_url: "mqtt://10.0.0.1:1883".into(),
            connected: true,
            published: 71_990,
            dropped: 10,
            last_connack_us: Some(1_792_396_400_000_000),
        },
        log: LogStatus {
            dir: "/var/lib/kart-agent/log".into(),
            active_segment: Some("seg-000000071000-20261019T080000Z.mcap.active".into()),
            total_bytes: 52_428_800,
            segments: 3,
            fs_free_bytes: 20_000_000_000,
            last_sync_us: Some(1_792_400_001_500_000),
            write_errors: 0,
            last_error: None,
            dropped: 0,
        },
    }
}

#[test]
fn fixture_matches_the_status_type() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/status.json");
    let json = serde_json::to_string_pretty(&sample()).unwrap() + "\n";
    if std::env::var_os("UPDATE_FIXTURES").is_some() {
        std::fs::write(path, &json).unwrap();
    }
    let fixture = std::fs::read_to_string(path).expect("run with UPDATE_FIXTURES=1 once");
    assert_eq!(fixture, json, "fixture out of date, see the module docs");
}
