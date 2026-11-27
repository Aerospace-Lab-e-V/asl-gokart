//! Enrollment requests, in memory. A request lives until it expires (pending) or until
//! the device had time to collect its credentials (approved or rejected). After a restart
//! of the service the device simply starts over.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Result, anyhow};
use enroll_proto::{Credentials, DeviceKind, EnrollState};
use serde::Serialize;

/// Codes avoid characters that are easy to confuse on a screen (0/O, 1/I/L).
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

#[derive(Debug, Clone)]
pub struct Request {
    pub request_id: String,
    pub code: String,
    pub kind: DeviceKind,
    pub requested_id: String,
    pub csr: String,
    /// Address the request came from (the border Nginx's `X-Real-IP` when present).
    pub source: String,
    pub created_at_s: i64,
    pub expires_at_s: i64,
    pub outcome: Outcome,
}

#[derive(Debug, Clone)]
pub enum Outcome {
    Pending,
    Approved(Box<Credentials>),
    Rejected,
}

/// What the admin CLI lists.
#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    pub code: String,
    pub kind: DeviceKind,
    pub requested_id: String,
    pub source: String,
    pub created_at_s: i64,
    pub expires_at_s: i64,
    pub state: &'static str,
}

pub struct Store {
    requests: Mutex<HashMap<String, Request>>,
    ttl_s: i64,
    max_pending: usize,
}

impl Store {
    pub fn new(ttl_s: i64, max_pending: usize) -> Self {
        Self {
            requests: Mutex::default(),
            ttl_s,
            max_pending,
        }
    }

    /// Adds a pending request; refuses when too many are waiting (someone flooding the
    /// public endpoint must not fill the memory or the admin's list).
    pub fn add(
        &self,
        kind: DeviceKind,
        requested_id: String,
        csr: String,
        source: String,
    ) -> Result<Request> {
        let now = now_s();
        let mut map = self.requests.lock().expect("store");
        map.retain(|_, r| r.expires_at_s > now);
        let pending = map
            .values()
            .filter(|r| matches!(r.outcome, Outcome::Pending))
            .count();
        if pending >= self.max_pending {
            return Err(anyhow!("too many pending requests, try again later"));
        }
        let code = loop {
            let c = random_code()?;
            if !map.values().any(|r| r.code == c) {
                break c;
            }
        };
        let request = Request {
            request_id: random_hex(16)?,
            code,
            kind,
            requested_id,
            csr,
            source,
            created_at_s: now,
            expires_at_s: now + self.ttl_s,
            outcome: Outcome::Pending,
        };
        map.insert(request.request_id.clone(), request.clone());
        Ok(request)
    }

    /// The device's view of its request; `None` when unknown or expired.
    pub fn state(&self, request_id: &str) -> Option<EnrollState> {
        let now = now_s();
        let map = self.requests.lock().expect("store");
        let r = map.get(request_id).filter(|r| r.expires_at_s > now)?;
        Some(match &r.outcome {
            Outcome::Pending => EnrollState::Pending {
                code: r.code.clone(),
                expires_at_s: r.expires_at_s,
            },
            Outcome::Approved(c) => EnrollState::Approved((**c).clone()),
            Outcome::Rejected => EnrollState::Rejected,
        })
    }

    /// The pending request with this code (case and dash insensitive).
    pub fn pending_by_code(&self, code: &str) -> Option<Request> {
        let want = normalize_code(code);
        let now = now_s();
        self.requests
            .lock()
            .expect("store")
            .values()
            .find(|r| {
                r.expires_at_s > now
                    && matches!(r.outcome, Outcome::Pending)
                    && normalize_code(&r.code) == want
            })
            .cloned()
    }

    /// Records the decision. The answer stays collectable for another TTL.
    pub fn decide(&self, request_id: &str, outcome: Outcome) -> bool {
        let mut map = self.requests.lock().expect("store");
        let Some(r) = map.get_mut(request_id) else {
            return false;
        };
        if !matches!(r.outcome, Outcome::Pending) {
            return false;
        }
        r.outcome = outcome;
        r.expires_at_s = now_s() + self.ttl_s;
        true
    }

    pub fn list(&self) -> Vec<Summary> {
        let now = now_s();
        let mut list: Vec<Summary> = self
            .requests
            .lock()
            .expect("store")
            .values()
            .filter(|r| r.expires_at_s > now)
            .map(|r| Summary {
                code: r.code.clone(),
                kind: r.kind,
                requested_id: r.requested_id.clone(),
                source: r.source.clone(),
                created_at_s: r.created_at_s,
                expires_at_s: r.expires_at_s,
                state: match r.outcome {
                    Outcome::Pending => "pending",
                    Outcome::Approved(_) => "approved",
                    Outcome::Rejected => "rejected",
                },
            })
            .collect();
        list.sort_by_key(|s| s.created_at_s);
        list
    }
}

pub fn now_s() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// `XXXX-XXXX` from [`CODE_ALPHABET`]: about 39 bits, and the server picks it, so a
/// requester cannot choose a code that matches another device's screen.
fn random_code() -> Result<String> {
    let mut out = String::with_capacity(9);
    while out.len() < 9 {
        let mut b = [0u8; 1];
        getrandom::fill(&mut b).map_err(|e| anyhow!("random: {e}"))?;
        // Rejection sampling keeps the distribution uniform.
        let limit = 256 - 256 % CODE_ALPHABET.len();
        if (b[0] as usize) < limit {
            if out.len() == 4 {
                out.push('-');
            }
            out.push(CODE_ALPHABET[b[0] as usize % CODE_ALPHABET.len()] as char);
        }
    }
    Ok(out)
}

/// `n` random bytes as hex.
pub fn random_hex(n: usize) -> Result<String> {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).map_err(|e| anyhow!("random: {e}"))?;
    Ok(crate::ca::hex(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_look_right() {
        for _ in 0..100 {
            let c = random_code().unwrap();
            assert_eq!(c.len(), 9);
            assert_eq!(&c[4..5], "-");
            assert!(
                c.chars()
                    .filter(|&c| c != '-')
                    .all(|c| CODE_ALPHABET.contains(&(c as u8)))
            );
        }
    }

    #[test]
    fn lifecycle_and_limits() {
        let store = Store::new(600, 2);
        let a = store
            .add(
                DeviceKind::Kart,
                "kart-01".into(),
                "csr".into(),
                "lab".into(),
            )
            .unwrap();
        store
            .add(
                DeviceKind::Kart,
                "kart-02".into(),
                "csr".into(),
                "lab".into(),
            )
            .unwrap();
        assert!(
            store
                .add(
                    DeviceKind::Kart,
                    "kart-03".into(),
                    "csr".into(),
                    "lab".into()
                )
                .is_err()
        );

        let lower = a.code.to_lowercase().replace('-', "");
        assert_eq!(
            store.pending_by_code(&lower).unwrap().request_id,
            a.request_id
        );
        assert!(matches!(
            store.state(&a.request_id),
            Some(EnrollState::Pending { .. })
        ));

        assert!(store.decide(&a.request_id, Outcome::Rejected));
        assert!(
            !store.decide(&a.request_id, Outcome::Rejected),
            "decided once"
        );
        assert_eq!(store.state(&a.request_id), Some(EnrollState::Rejected));
        assert!(store.pending_by_code(&a.code).is_none());
        assert!(store.state("unknown").is_none());
        // A decided request frees its pending slot.
        store
            .add(
                DeviceKind::Kart,
                "kart-03".into(),
                "csr".into(),
                "lab".into(),
            )
            .unwrap();
    }
}
