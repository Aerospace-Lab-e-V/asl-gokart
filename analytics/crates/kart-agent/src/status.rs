//! What `GET /v1/status` reports. Each component owns its part and updates it in
//! [`Shared`]; the API serialises a snapshot. `tests/fixtures/status.json` is the
//! contract the headunit's Telemetry page is tested against.

use std::{
    collections::BTreeMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Status {
    pub agent: AgentStatus,
    pub session: SessionStatus,
    pub clock: ClockStatus,
    pub sero: SeroStatus,
    pub live: LiveStatus,
    pub log: LogStatus,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct AgentStatus {
    pub version: String,
    pub uptime_s: u64,
    /// Agent starts within this session.
    pub runs: u32,
    /// A configuration change is being applied.
    pub restart_pending: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SessionStatus {
    pub id: String,
    pub boot_id: String,
    pub next_seq: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ClockStatus {
    /// The kernel considers the clock synchronised (NTP/GPS). Sample times are only
    /// trustworthy when this is true.
    pub synced: bool,
    pub max_error_us: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SeroStatus {
    /// `starting`, `waiting_for_interface`, `running` or `error`
    pub state: String,
    pub error: Option<String>,
    pub interface: String,
    pub address: Option<String>,
    pub client_id: u16,
    pub services: Vec<ServiceStatus>,
    pub counters: BTreeMap<String, u32>,
    /// Events dropped because the agent could not keep up (should stay 0).
    pub rx_queue_full: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ServiceStatus {
    pub id: u16,
    pub name: String,
    pub found: bool,
    pub provider: Option<String>,
    pub events: Vec<EventStatus>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct EventStatus {
    pub id: u16,
    /// Return code of the last subscription acknowledgement (0 = accepted).
    pub ack: Option<u8>,
    /// Last accepted subscription (µs since the Unix epoch).
    pub last_ack_us: Option<i64>,
    pub last_rx_us: Option<i64>,
    pub rx: u64,
    pub decode_errors: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct LiveStatus {
    pub enabled: bool,
    /// A broker URL is set.
    pub configured: bool,
    pub broker_url: String,
    pub connected: bool,
    pub published: u64,
    pub dropped: u64,
    pub last_connack_us: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct LogStatus {
    pub dir: String,
    pub active_segment: Option<String>,
    pub total_bytes: u64,
    pub segments: u64,
    pub fs_free_bytes: u64,
    pub last_sync_us: Option<i64>,
    pub write_errors: u64,
    pub last_error: Option<String>,
    /// Batches or events the writer could not keep up with (should stay 0).
    pub dropped: u64,
}

/// State shared between the components and the API.
#[derive(Debug, Default)]
pub struct Shared {
    status: Mutex<Status>,
    /// Monotonic ms of the batcher's last tick, for the watchdog.
    pub pipeline_heartbeat_ms: AtomicU64,
    /// Monotonic ms of the log writer's last loop, for the watchdog.
    pub log_heartbeat_ms: AtomicU64,
}

impl Shared {
    pub fn snapshot(&self) -> Status {
        self.status.lock().expect("status lock").clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut Status)) {
        f(&mut self.status.lock().expect("status lock"));
    }

    pub fn beat(counter: &AtomicU64) {
        counter.store(sero_sys::now_ms() as u64, Ordering::Relaxed);
    }

    /// Both loops ran within `max_age_ms`.
    pub fn healthy(&self, max_age_ms: u64) -> bool {
        let now = sero_sys::now_ms() as u64;
        [&self.pipeline_heartbeat_ms, &self.log_heartbeat_ms]
            .iter()
            .all(|c| now.saturating_sub(c.load(Ordering::Relaxed)) <= max_age_ms)
    }
}
