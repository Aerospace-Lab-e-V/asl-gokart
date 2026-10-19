//! The local session log, the source of truth for all telemetry.
//!
//! Every live batch is written, byte for byte as published, to MCAP segments under
//! `<state>/log/<session_id>/seg-<first_seq>-<utc>.mcap`. A segment is written as
//! `.mcap.active` and renamed once finished. Chunks are closed and fdatasync'ed every
//! `log.sync_interval_ms`, so after a power cut an `.active` file is readable up to
//! the last sync (`mcap recover`, or any reader that ignores the missing footer).
//!
//! Each segment is self-describing: the protobuf schema, a `session` metadata record
//! and `signals.yaml` as attachment. Agent events (ECU found/lost, subscriptions,
//! configuration) go to a JSON channel `/agent/events`.
//!
//! The writer runs on its own thread; [`LogHandle`] never blocks the caller.

use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, BufWriter},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use mcap::{Compression, WriteOptions, Writer, records::MessageHeader};
use serde_json::Value;
use tracing::{info, warn};

use crate::{
    config,
    status::{LogStatus, Shared},
};

/// Facts about the session recorded in every segment.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub kart_id: String,
    pub session_id: String,
    pub boot_id: String,
    pub agent_version: String,
    pub run: u32,
}

enum Msg {
    Batch {
        seq: u64,
        time_ns: u64,
        data: Vec<u8>,
    },
    Event {
        time_ns: u64,
        data: Vec<u8>,
    },
    Stop,
}

/// Cheap to clone; sending never blocks. If the writer falls behind by thousands of
/// batches, further ones are counted as dropped.
#[derive(Clone)]
pub struct LogHandle {
    tx: mpsc::SyncSender<Msg>,
    dropped: Arc<AtomicU64>,
}

impl LogHandle {
    pub fn batch(&self, seq: u64, time_ns: u64, data: Vec<u8>) {
        self.send(Msg::Batch { seq, time_ns, data });
    }

    /// An agent event, e.g. `event("sero.service_found", json!({...}))`.
    pub fn event(&self, kind: &str, mut fields: Value) {
        if let Value::Object(map) = &mut fields {
            map.insert("event".into(), kind.into());
        }
        let data = serde_json::to_vec(&fields).expect("serialising JSON");
        self.send(Msg::Event {
            time_ns: now_ns(),
            data,
        });
    }

    fn send(&self, msg: Msg) {
        if self.tx.try_send(msg).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// The writer thread. [`LogWriter::stop`] finishes the active segment.
pub struct LogWriter {
    tx: mpsc::SyncSender<Msg>,
    join: Option<JoinHandle<()>>,
}

impl LogWriter {
    pub fn spawn(
        state_dir: &Path,
        session: SessionInfo,
        first_seq: u64,
        log: config::Log,
        retention: config::Retention,
        shared: Arc<Shared>,
    ) -> io::Result<(Self, LogHandle)> {
        let root = state_dir.join("log");
        let dir = root.join(&session.session_id);
        fs::create_dir_all(&dir)?;
        let (tx, rx) = mpsc::sync_channel(4096);
        let dropped = Arc::new(AtomicU64::new(0));
        let mut state = WriterState {
            root,
            dir,
            session,
            next_seq: first_seq,
            log,
            retention,
            shared,
            dropped: dropped.clone(),
            segment: None,
            status: LogStatus::default(),
        };
        let join = std::thread::Builder::new()
            .name("log-writer".into())
            .spawn(move || state.run(rx))?;
        Ok((
            Self {
                tx: tx.clone(),
                join: Some(join),
            },
            LogHandle { tx, dropped },
        ))
    }

    /// Writes what is queued, finishes the segment and waits for the thread.
    pub fn stop(mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

const RETENTION_EVERY: Duration = Duration::from_secs(60);

struct WriterState {
    root: PathBuf,
    dir: PathBuf,
    session: SessionInfo,
    /// Sequence number the next batch will most likely have; names new segments.
    next_seq: u64,
    log: config::Log,
    retention: config::Retention,
    shared: Arc<Shared>,
    dropped: Arc<AtomicU64>,
    segment: Option<Segment>,
    status: LogStatus,
}

impl WriterState {
    fn run(&mut self, rx: mpsc::Receiver<Msg>) {
        let sync_every = Duration::from_millis(self.log.sync_interval_ms);
        let rotate_every = Duration::from_secs(self.log.segment_minutes * 60);
        let mut next_sync = Instant::now() + sync_every;
        let mut next_retention = Instant::now();
        self.status.dir = self.root.display().to_string();
        loop {
            let timeout = next_sync.saturating_duration_since(Instant::now());
            match rx.recv_timeout(timeout) {
                Ok(Msg::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Ok(msg) => self.write(msg),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            Shared::beat(&self.shared.log_heartbeat_ms);
            let now = Instant::now();
            if now >= next_sync {
                next_sync = now + sync_every;
                self.sync();
                if self
                    .segment
                    .as_ref()
                    .is_some_and(|s| s.opened.elapsed() >= rotate_every)
                {
                    self.close_segment();
                    next_retention = now;
                }
            }
            if now >= next_retention {
                next_retention = now + RETENTION_EVERY;
                self.enforce_retention();
                self.publish_status();
            }
        }
        self.close_segment();
        self.enforce_retention();
        self.publish_status();
    }

    fn write(&mut self, msg: Msg) {
        if self.segment.is_none() {
            match Segment::create(&self.dir, &self.session, self.next_seq) {
                Ok(s) => {
                    info!(segment = %s.path.display(), "log segment opened");
                    self.segment = Some(s);
                }
                Err(e) => return self.error("opening a log segment", e),
            }
        }
        let segment = self.segment.as_mut().expect("segment just opened");
        let result = match msg {
            Msg::Batch { seq, time_ns, data } => {
                self.next_seq = seq + 1;
                segment.write_batch(seq, time_ns, &data)
            }
            Msg::Event { time_ns, data } => segment.write_event(time_ns, &data),
            Msg::Stop => Ok(()),
        };
        if let Err(e) = result {
            self.error("writing the log", e);
            // The file may be inconsistent now; keep what is there and start a new one.
            self.close_segment();
        }
    }

    fn sync(&mut self) {
        let Some(segment) = &mut self.segment else {
            return;
        };
        match segment.sync() {
            Ok(()) => self.status.last_sync_us = Some(now_ns() as i64 / 1000),
            Err(e) => {
                self.error("syncing the log", e);
                self.close_segment();
            }
        }
        self.publish_status();
    }

    fn close_segment(&mut self) {
        if let Some(segment) = self.segment.take() {
            match segment.finish() {
                Ok(path) => info!(segment = %path.display(), "log segment finished"),
                Err(e) => self.error("finishing a log segment", e),
            }
        }
    }

    fn enforce_retention(&mut self) {
        match enforce_retention(&self.root, &self.dir, &self.retention) {
            Ok(usage) => {
                self.status.total_bytes = usage.total_bytes;
                self.status.segments = usage.segments;
                self.status.fs_free_bytes = usage.free_bytes;
            }
            Err(e) => self.error("enforcing log retention", e),
        }
    }

    fn error(&mut self, what: &str, e: impl std::fmt::Display) {
        warn!("{what}: {e}");
        self.status.write_errors += 1;
        self.status.last_error = Some(format!("{what}: {e}"));
    }

    fn publish_status(&mut self) {
        self.status.active_segment = self
            .segment
            .as_ref()
            .and_then(|s| s.path.file_name())
            .map(|n| n.to_string_lossy().into_owned());
        self.status.dropped = self.dropped.load(Ordering::Relaxed);
        let status = self.status.clone();
        self.shared.update(|s| s.log = status);
    }
}

/// One MCAP file being written.
pub struct Segment {
    path: PathBuf,
    writer: Writer<BufWriter<File>>,
    /// Second handle on the same file, for fdatasync while the writer owns it.
    file: File,
    batch_channel: u16,
    event_channel: u16,
    opened: Instant,
}

pub const ACTIVE_SUFFIX: &str = ".mcap.active";
pub const SCHEMA_NAME: &str = "kart.telemetry.v1.Batch";
pub const EVENTS_TOPIC: &str = "/agent/events";

impl Segment {
    pub fn create(dir: &Path, session: &SessionInfo, first_seq: u64) -> io::Result<Self> {
        let path = dir.join(format!(
            "seg-{first_seq:012}-{}{ACTIVE_SUFFIX}",
            utc_compact(SystemTime::now())
        ));
        let file = File::create_new(&path)?;
        let sync_handle = file.try_clone()?;
        let mut writer = WriteOptions::new()
            .compression(Some(Compression::Zstd))
            .library(format!("kart-agent/{}", session.agent_version))
            .create(BufWriter::new(file))
            .map_err(io::Error::other)?;
        let schema = writer
            .add_schema(
                SCHEMA_NAME,
                "protobuf",
                telemetry_schema::FILE_DESCRIPTOR_SET,
            )
            .map_err(io::Error::other)?;
        let batch_channel = writer
            .add_channel(
                schema,
                &telemetry_schema::live_topic(&session.kart_id),
                "protobuf",
                &BTreeMap::new(),
            )
            .map_err(io::Error::other)?;
        let event_channel = writer
            .add_channel(0, EVENTS_TOPIC, "json", &BTreeMap::new())
            .map_err(io::Error::other)?;
        let clock = crate::clock::status();
        let metadata = BTreeMap::from([
            ("kart_id".to_owned(), session.kart_id.clone()),
            ("session_id".to_owned(), session.session_id.clone()),
            ("boot_id".to_owned(), session.boot_id.clone()),
            ("agent_version".to_owned(), session.agent_version.clone()),
            (
                "schema_version".to_owned(),
                telemetry_schema::SCHEMA_VERSION.to_owned(),
            ),
            ("run".to_owned(), session.run.to_string()),
            ("first_seq".to_owned(), first_seq.to_string()),
            ("clock_synced".to_owned(), clock.synced.to_string()),
        ]);
        writer
            .write_metadata(&mcap::records::Metadata {
                name: "session".into(),
                metadata,
            })
            .map_err(io::Error::other)?;
        let now = now_ns();
        writer
            .attach(&mcap::Attachment {
                log_time: now,
                create_time: now,
                name: "signals.yaml".into(),
                media_type: "application/yaml".into(),
                data: telemetry_schema::SIGNALS_YAML.as_bytes().into(),
            })
            .map_err(io::Error::other)?;
        Ok(Self {
            path,
            writer,
            file: sync_handle,
            batch_channel,
            event_channel,
            opened: Instant::now(),
        })
    }

    pub fn write_batch(&mut self, seq: u64, time_ns: u64, data: &[u8]) -> io::Result<()> {
        self.write(self.batch_channel, seq as u32, time_ns, data)
    }

    pub fn write_event(&mut self, time_ns: u64, data: &[u8]) -> io::Result<()> {
        self.write(self.event_channel, 0, time_ns, data)
    }

    fn write(
        &mut self,
        channel_id: u16,
        sequence: u32,
        time_ns: u64,
        data: &[u8],
    ) -> io::Result<()> {
        self.writer
            .write_to_known_channel(
                &MessageHeader {
                    channel_id,
                    sequence,
                    log_time: time_ns,
                    publish_time: time_ns,
                },
                data,
            )
            .map_err(io::Error::other)
    }

    /// Closes the current chunk and makes everything so far durable.
    pub fn sync(&mut self) -> io::Result<()> {
        self.writer.flush().map_err(io::Error::other)?;
        self.file.sync_data()
    }

    /// Writes the summary and footer and renames the file to `.mcap`.
    pub fn finish(mut self) -> io::Result<PathBuf> {
        let finished = self.writer.finish().map_err(io::Error::other);
        let synced = self.file.sync_all();
        let done = finished_path(&self.path);
        // Rename even after an error: a partial segment is still worth keeping.
        fs::rename(&self.path, &done)?;
        if let Some(dir) = done.parent() {
            File::open(dir)?.sync_all()?;
        }
        finished?;
        synced?;
        Ok(done)
    }
}

fn finished_path(active: &Path) -> PathBuf {
    let name = active.file_name().unwrap_or_default().to_string_lossy();
    active.with_file_name(name.replace(ACTIVE_SUFFIX, ".mcap"))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Usage {
    pub total_bytes: u64,
    pub segments: u64,
    pub free_bytes: u64,
}

/// Deletes the oldest finished segments while the log is over `max_bytes` or the disk
/// is below `min_free_bytes`. Active segments are never touched. Also renames
/// `.active` leftovers of earlier runs (crash, power cut) in other sessions to `.mcap`.
pub fn enforce_retention(
    root: &Path,
    current: &Path,
    retention: &config::Retention,
) -> io::Result<Usage> {
    let mut finished = Vec::new();
    let mut total = 0u64;
    for session in fs::read_dir(root)? {
        let session = session?.path();
        if !session.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&session)? {
            let path = entry?.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let Ok(meta) = fs::metadata(&path) else {
                continue;
            };
            total += meta.len();
            if name.ends_with(ACTIVE_SUFFIX) && session != current {
                let done = finished_path(&path);
                fs::rename(&path, &done)?;
                finished.push((meta.modified()?, done, meta.len()));
            } else if name.ends_with(".mcap") {
                finished.push((meta.modified()?, path, meta.len()));
            }
        }
    }
    finished.sort();
    let mut free = free_bytes(root)?;
    let mut segments = finished.len() as u64;
    for (_, path, len) in finished {
        if total <= retention.max_bytes && free >= retention.min_free_bytes {
            break;
        }
        warn!(segment = %path.display(), "deleting old log segment (retention)");
        fs::remove_file(&path)?;
        total -= len;
        free += len;
        segments -= 1;
        if let Some(dir) = path.parent()
            && dir != current
            && fs::read_dir(dir)?.next().is_none()
        {
            fs::remove_dir(dir)?;
        }
    }
    let active = fs::read_dir(current)?
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(ACTIVE_SUFFIX))
        .count() as u64;
    Ok(Usage {
        total_bytes: total,
        segments: segments + active,
        free_bytes: free,
    })
}

fn free_bytes(path: &Path) -> io::Result<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(io::Error::other)?;
    // SAFETY: valid NUL-terminated path; statvfs fills the struct.
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(st.f_bavail as u64 * st.f_frsize as u64)
}

pub fn now_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before 1970")
        .as_nanos() as u64
}

/// `20261019T143000Z`, without pulling in a date library.
fn utc_compact(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_names() {
        let t = UNIX_EPOCH + Duration::from_secs(1_792_400_000);
        assert_eq!(utc_compact(t), "20261019T085320Z");
        assert_eq!(utc_compact(UNIX_EPOCH), "19700101T000000Z");
    }
}
