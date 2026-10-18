//! Shared telemetry types, generated from `analytics/schema/`.
//!
//! - [`v1`]: protobuf messages from `schema/proto/telemetry.proto`
//! - [`signals`]: the signal catalog from `schema/signals.yaml`
//! - topic helpers for the MQTT layout described in the analytics README

use std::sync::OnceLock;

use serde::Deserialize;

pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/kart.telemetry.v1.rs"));
}

/// Recorded with every session so old logs stay decodable.
pub const SCHEMA_VERSION: &str = env!("CARGO_PKG_VERSION");

const SIGNALS_YAML: &str = include_str!("../../../schema/signals.yaml");

#[derive(Debug, Clone, Deserialize)]
pub struct Signal {
    pub id: u32,
    pub name: String,
    pub ecu: String,
    pub unit: String,
    pub rate_hz: f64,
    pub min: f64,
    pub max: f64,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub deprecated: bool,
}

#[derive(Deserialize)]
struct Catalog {
    signals: Vec<Signal>,
}

/// All signals from `schema/signals.yaml`, in file order.
pub fn signals() -> &'static [Signal] {
    static SIGNALS: OnceLock<Vec<Signal>> = OnceLock::new();
    SIGNALS.get_or_init(|| {
        serde_norway::from_str::<Catalog>(SIGNALS_YAML)
            .expect("schema/signals.yaml is invalid")
            .signals
    })
}

pub fn signal_by_name(name: &str) -> Option<&'static Signal> {
    signals().iter().find(|s| s.name == name)
}

pub fn live_topic(kart_id: &str) -> String {
    format!("kart/{kart_id}/live")
}

pub fn status_topic(kart_id: &str) -> String {
    format!("kart/{kart_id}/status")
}

/// Extracts `{id}` from `kart/{id}/...`.
pub fn kart_id_from_topic(topic: &str) -> Option<&str> {
    let mut parts = topic.split('/');
    match (parts.next(), parts.next()) {
        (Some("kart"), Some(id)) if !id.is_empty() => Some(id),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use prost::Message;

    use super::*;

    #[test]
    fn catalog_parses_and_is_consistent() {
        let signals = signals();
        assert!(!signals.is_empty());

        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        for s in signals {
            assert!(ids.insert(s.id), "duplicate signal id {}", s.id);
            assert!(names.insert(&s.name), "duplicate signal name {}", s.name);
            assert!(s.min < s.max, "{}: min must be < max", s.name);
            assert!(s.rate_hz > 0.0, "{}: rate_hz must be > 0", s.name);
        }
    }

    #[test]
    fn batch_round_trip() {
        let batch = v1::Batch {
            kart_id: "kart-01".into(),
            session_id: "0190a0e0-0000-7000-8000-000000000000".into(),
            seq: 42,
            samples: vec![v1::Sample {
                signal_id: 101,
                t_us: 1_700_000_000_000_000,
                value: 48.2,
            }],
        };
        let decoded = v1::Batch::decode(batch.encode_to_vec().as_slice()).unwrap();
        assert_eq!(decoded, batch);
    }

    #[test]
    fn topics() {
        assert_eq!(live_topic("kart-01"), "kart/kart-01/live");
        assert_eq!(kart_id_from_topic("kart/kart-01/live"), Some("kart-01"));
        assert_eq!(kart_id_from_topic("other/kart-01/live"), None);
    }
}
