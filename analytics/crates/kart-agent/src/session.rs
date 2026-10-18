//! One telemetry session per power cycle of the Pi.
//!
//! The session is keyed by the kernel's boot id and stored in the systemd runtime
//! directory (tmpfs, kept across service restarts, gone after a reboot). An agent
//! restart or update in the middle of a run therefore continues the same session and
//! sequence numbers instead of starting a new one.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const BOOT_ID_PATH: &str = "/proc/sys/kernel/random/boot_id";
const FILE: &str = "session.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Stored {
    version: u32,
    boot_id: String,
    session_id: String,
    next_seq: u64,
    /// Agent starts within this session (1 = first).
    runs: u32,
}

#[derive(Debug)]
pub struct Session {
    path: PathBuf,
    stored: Stored,
}

impl Session {
    pub fn open(runtime_dir: &Path, boot_id_path: &Path) -> Result<Self> {
        let boot_id = fs::read_to_string(boot_id_path)
            .with_context(|| format!("reading {}", boot_id_path.display()))?
            .trim()
            .to_owned();
        let path = runtime_dir.join(FILE);
        let previous = fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Stored>(&b).ok())
            .filter(|s| s.version == 1 && s.boot_id == boot_id);
        let stored = match previous {
            Some(s) => Stored {
                runs: s.runs + 1,
                ..s
            },
            None => Stored {
                version: 1,
                boot_id,
                session_id: Uuid::now_v7().to_string(),
                next_seq: 0,
                runs: 1,
            },
        };
        let session = Self { path, stored };
        session.persist()?;
        Ok(session)
    }

    pub fn id(&self) -> &str {
        &self.stored.session_id
    }

    pub fn boot_id(&self) -> &str {
        &self.stored.boot_id
    }

    pub fn next_seq(&self) -> u64 {
        self.stored.next_seq
    }

    pub fn runs(&self) -> u32 {
        self.stored.runs
    }

    /// Takes the next batch sequence number. It is persisted before it is used, so a
    /// crash right after can never hand out the same number twice.
    pub fn reserve_seq(&mut self) -> io::Result<u64> {
        let seq = self.stored.next_seq;
        self.stored.next_seq += 1;
        self.persist()?;
        Ok(seq)
    }

    fn persist(&self) -> io::Result<()> {
        // tmpfs: an atomic rename is enough, no fsync needed.
        let tmp = self.path.with_extension("tmp");
        fs::write(&tmp, serde_json::to_vec(&self.stored)?)?;
        fs::rename(&tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("kart-agent-session-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn restart_continues_and_reboot_starts_over() {
        let d = dir("restart");
        let boot = d.join("boot_id");
        fs::write(&boot, "aaaa\n").unwrap();

        let mut s = Session::open(&d, &boot).unwrap();
        assert_eq!((s.reserve_seq().unwrap(), s.reserve_seq().unwrap()), (0, 1));
        let id = s.id().to_owned();
        drop(s);

        // Agent restart, same boot: same session, numbering continues.
        let mut s = Session::open(&d, &boot).unwrap();
        assert_eq!(s.id(), id);
        assert_eq!(s.runs(), 2);
        assert_eq!(s.reserve_seq().unwrap(), 2);

        // Reboot: new session from 0.
        fs::write(&boot, "bbbb\n").unwrap();
        let mut s = Session::open(&d, &boot).unwrap();
        assert_ne!(s.id(), id);
        assert_eq!((s.runs(), s.reserve_seq().unwrap()), (1, 0));
    }
}
