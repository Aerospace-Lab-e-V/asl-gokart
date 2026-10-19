//! systemd integration (`Type=notify`, `WatchdogSec=`). Every call is a no-op when the
//! agent does not run under systemd.

use std::{sync::Arc, time::Duration};

use sd_notify::NotifyState;
use tracing::warn;

use crate::status::Shared;

pub fn ready() {
    notify(&[NotifyState::Ready]);
}

pub fn stopping() {
    notify(&[NotifyState::Stopping]);
}

pub fn status(text: &str) {
    notify(&[NotifyState::Status(text)]);
}

fn notify(state: &[NotifyState]) {
    if let Err(e) = sd_notify::notify(state) {
        warn!("sd_notify: {e}");
    }
}

/// Pings the watchdog at half its interval, but only while the agent's loops are
/// alive, so a hung agent gets restarted.
pub fn spawn_watchdog(shared: Arc<Shared>) {
    let Some(interval) = sd_notify::watchdog_enabled() else {
        return;
    };
    let max_age_ms = interval.as_millis() as u64 / 2;
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(interval / 2);
        loop {
            tick.tick().await;
            if shared.healthy(max_age_ms.max(1000)) {
                notify(&[NotifyState::Watchdog]);
            } else {
                warn!("a loop is stuck, not feeding the watchdog");
            }
        }
    });
}

/// Delay before an in-process restart, so the API reply goes out first.
pub const RESTART_DELAY: Duration = Duration::from_millis(200);
