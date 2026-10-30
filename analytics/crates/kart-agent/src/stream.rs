//! The headunit's live stream, served as Server-Sent Events on `GET /v1/stream`.
//!
//! The pipeline pushes every sample into the [`Tap`] as it arrives, before batching, so
//! the headunit does not wait for `live.batch_ms`. A subscriber first gets the last value
//! of every signal, then everything that follows. Each `samples` event is one timestamp
//! (one Sero event or one GPS epoch) as JSON by catalog name:
//! `{"t_us":…,"samples":{"gps.lat":48.6,…}}`. `tests/fixtures/stream.sse` is the
//! contract the headunit's agent adapter is tested against. See ADR-0002.

use std::{
    collections::{BTreeMap, HashMap},
    convert::Infallible,
    sync::{Arc, Mutex},
};

use axum::response::sse::Event;
use futures_util::{Stream, StreamExt, stream};
use serde::Serialize;
use telemetry_schema::{signal_by_id, v1::Sample};
use tokio::sync::{broadcast, watch};
use tracing::debug;

/// A few seconds of pushes at today's rates; a subscriber that falls further behind gets
/// the snapshot again.
const CAPACITY: usize = 256;

pub struct Tap {
    latest: Mutex<HashMap<u32, Sample>>,
    tx: broadcast::Sender<Arc<Vec<Sample>>>,
}

impl Default for Tap {
    fn default() -> Self {
        Self {
            latest: Mutex::default(),
            tx: broadcast::channel(CAPACITY).0,
        }
    }
}

impl Tap {
    pub fn push(&self, samples: &[Sample]) {
        if samples.is_empty() {
            return;
        }
        let mut latest = self.latest.lock().expect("tap lock");
        for s in samples {
            latest.insert(s.signal_id, *s);
        }
        drop(latest);
        let _ = self.tx.send(Arc::new(samples.to_vec()));
    }

    /// The last value of every signal, oldest first.
    pub fn snapshot(&self) -> Vec<Sample> {
        let mut all: Vec<Sample> = self
            .latest
            .lock()
            .expect("tap lock")
            .values()
            .copied()
            .collect();
        all.sort_by_key(|s| (s.t_us, s.signal_id));
        all
    }

    /// Subscribes before taking the snapshot, so a push in between is not lost (at worst
    /// it arrives twice, which is harmless for last-value consumers).
    fn subscribe(&self) -> (Vec<Sample>, broadcast::Receiver<Arc<Vec<Sample>>>) {
        let rx = self.tx.subscribe();
        (self.snapshot(), rx)
    }
}

#[derive(Serialize)]
struct Frame<'a> {
    t_us: i64,
    samples: BTreeMap<&'a str, f64>,
}

/// One JSON frame per timestamp, in order. Signals missing from the catalog and
/// non-finite values (JSON has no NaN) are left out.
pub fn frames(samples: &[Sample]) -> Vec<String> {
    samples
        .chunk_by(|a, b| a.t_us == b.t_us)
        .filter_map(|group| {
            let samples: BTreeMap<&str, f64> = group
                .iter()
                .filter(|s| s.value.is_finite())
                .filter_map(|s| Some((signal_by_id(s.signal_id)?.name.as_str(), s.value)))
                .collect();
            (!samples.is_empty()).then(|| {
                serde_json::to_string(&Frame {
                    t_us: group[0].t_us,
                    samples,
                })
                .expect("a frame serialises")
            })
        })
        .collect()
}

/// The events for one subscriber: the snapshot, then every push, until `stop` is set.
/// Ending on `stop` matters: axum's graceful shutdown waits for every open response, so
/// an endless stream would hang each configuration restart.
pub fn events(
    tap: Arc<Tap>,
    stop: watch::Receiver<bool>,
) -> impl Stream<Item = Result<Event, Infallible>> + Send + 'static {
    let (snapshot, rx) = tap.subscribe();
    let live = stream::unfold((tap, rx, stop), |(tap, mut rx, mut stop)| async move {
        let frames = tokio::select! {
            biased;
            _ = stop.wait_for(|&stopped| stopped) => return None,
            received = rx.recv() => match received {
                Ok(samples) => frames(&samples),
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    debug!(n, "stream subscriber fell behind, resending the snapshot");
                    frames(&tap.snapshot())
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            },
        };
        Some((stream::iter(frames), (tap, rx, stop)))
    })
    .flatten();
    stream::iter(frames(&snapshot))
        .chain(live)
        .map(|data| Ok(Event::default().event("samples").data(data)))
}

#[cfg(test)]
mod tests {
    use telemetry_schema::ids;

    use super::*;

    fn sample(signal_id: u32, t_us: i64, value: f64) -> Sample {
        Sample {
            signal_id,
            t_us,
            value,
        }
    }

    #[test]
    fn one_frame_per_timestamp() {
        let frames = frames(&[
            sample(ids::GPS_FIX, 1, 3.0),
            sample(ids::GPS_SATELLITES, 1, 9.0),
            sample(ids::BATTERY_VOLTAGE, 2, 67.2),
        ]);
        assert_eq!(
            frames,
            [
                r#"{"t_us":1,"samples":{"gps.fix":3.0,"gps.satellites":9.0}}"#,
                r#"{"t_us":2,"samples":{"battery.voltage":67.2}}"#,
            ]
        );
    }

    #[test]
    fn unknown_signals_and_non_finite_values_are_left_out() {
        assert!(frames(&[sample(0, 1, 1.0), sample(ids::GPS_LAT, 1, f64::NAN)]).is_empty());
    }

    #[test]
    fn snapshot_keeps_the_last_value_per_signal() {
        let tap = Tap::default();
        tap.push(&[sample(ids::GPS_FIX, 1, 2.0), sample(ids::GPS_LAT, 1, 48.5)]);
        tap.push(&[sample(ids::GPS_FIX, 2, 3.0)]);
        assert_eq!(
            tap.snapshot(),
            [sample(ids::GPS_LAT, 1, 48.5), sample(ids::GPS_FIX, 2, 3.0)]
        );
    }
}
