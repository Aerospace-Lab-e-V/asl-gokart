//! The kart's identity for the uplink (ADR-0004): a client certificate for the border
//! Nginx and a broker login, obtained by enrollment.
//!
//! Enrollment: the agent generates a key (it never leaves the Pi), sends a CSR to the
//! enroll service and shows the code it gets back on the headunit. An admin approves the
//! request by that code; the agent polls, stores certificate and login, and restarts its
//! pipeline with them. A pending request survives pipeline and agent restarts.
//!
//! Files in `$STATE_DIRECTORY/identity/` (directory 0700, secrets 0600): `key.pem`,
//! `cert.pem`, `ca.pem`, `broker.json`, and `pending.json` while a request waits.

use std::{
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, anyhow, bail};
use enroll_proto::{
    Credentials, DeviceKind, EnrollRequest, EnrollState, EnrollTicket, REQUESTS_PATH,
};
use rcgen::{CertificateParams, DnType, KeyPair};
use serde::{Deserialize, Serialize};
use tokio::{sync::watch, task::JoinHandle};
use tracing::{info, warn};

use crate::status::{EnrollmentStatus, Shared};

const POLL: Duration = Duration::from_secs(3);

/// What the uplink needs from an enrolled kart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub device_id: String,
    pub mqtt_username: String,
    pub mqtt_password: String,
    pub mqtt_client_id: String,
    pub not_after_s: i64,
    #[serde(skip)]
    pub cert_pem: String,
    #[serde(skip)]
    pub key_pem: String,
}

impl Identity {
    pub fn load(dir: &Path) -> Result<Option<Self>> {
        let broker = dir.join("broker.json");
        if !broker.exists() {
            return Ok(None);
        }
        let mut id: Identity = serde_json::from_slice(&fs::read(&broker)?)
            .with_context(|| format!("parsing {}", broker.display()))?;
        id.cert_pem = fs::read_to_string(dir.join("cert.pem")).context("reading cert.pem")?;
        id.key_pem = fs::read_to_string(dir.join("key.pem")).context("reading key.pem")?;
        Ok(Some(id))
    }

    /// TLS for `wss://`: public roots (plus `extra_ca`) and this certificate.
    pub fn tls(&self, extra_ca: Option<&str>) -> Result<Arc<rustls::ClientConfig>> {
        kart_mqtt::tls::client_config(&self.cert_pem, &self.key_pem, extra_ca)
    }

    fn store(dir: &Path, creds: &Credentials, key_pem: &str) -> Result<Self> {
        let id = Identity {
            device_id: creds.device_id.clone(),
            mqtt_username: creds.mqtt_username.clone(),
            mqtt_password: creds.mqtt_password.clone(),
            mqtt_client_id: creds.mqtt_client_id.clone(),
            not_after_s: creds.not_after_s,
            cert_pem: creds.certificate.clone(),
            key_pem: key_pem.to_owned(),
        };
        // The certificate must belong to our key, or the proxy will refuse it.
        id.tls(None)
            .context("the issued certificate does not fit the key")?;
        write_private(&dir.join("key.pem"), key_pem.as_bytes())?;
        write_private(&dir.join("cert.pem"), creds.certificate.as_bytes())?;
        write_private(&dir.join("ca.pem"), creds.ca_certificate.as_bytes())?;
        // Last: its presence marks the identity as complete.
        write_private(&dir.join("broker.json"), &serde_json::to_vec_pretty(&id)?)?;
        Ok(id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Pending {
    origin: String,
    requested_id: String,
    request_id: String,
    code: String,
    expires_at_s: i64,
    key_pem: String,
}

/// Owns the enrollment task; outlives pipeline restarts.
pub struct Enrollment {
    dir: PathBuf,
    shared: Arc<Shared>,
    task: Mutex<Option<JoinHandle<()>>>,
    /// Bumped when a new identity was stored; the run loop restarts the pipeline.
    changed: watch::Sender<u64>,
}

impl Enrollment {
    /// Reports the stored identity and resumes a pending request. Inside a Tokio runtime.
    pub fn open(
        state_dir: &Path,
        shared: Arc<Shared>,
        extra_ca: Option<String>,
    ) -> Result<Arc<Self>> {
        let dir = state_dir.join("identity");
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)
            .with_context(|| format!("creating {}", dir.display()))?;
        let (changed, _) = watch::channel(0);
        let me = Arc::new(Self {
            dir,
            shared,
            task: Mutex::default(),
            changed,
        });
        me.report(None);
        match read_pending(&me.dir) {
            Ok(Some(p)) if p.expires_at_s > now_s() => {
                info!(code = %p.code, "resuming the pending enrollment");
                me.spawn_poll(p, extra_ca);
            }
            Ok(Some(_)) => me.clear_pending(),
            Ok(None) => {}
            Err(e) => warn!("pending enrollment: {e:#}"),
        }
        Ok(me)
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.changed.subscribe()
    }

    /// Starts a new request (replacing a pending one). Returns once the code is known.
    pub async fn start(
        self: &Arc<Self>,
        origin: &str,
        requested_id: &str,
        extra_ca: Option<String>,
    ) -> Result<()> {
        self.abort();
        self.clear_pending();
        let key = KeyPair::generate().context("generating the key")?;
        let mut params = CertificateParams::default();
        params
            .distinguished_name
            .push(DnType::CommonName, requested_id);
        let csr = params.serialize_request(&key)?.pem()?;
        let http = http_client(extra_ca.as_deref())?;
        let url = format!("{origin}{REQUESTS_PATH}");
        let res = http
            .post(&url)
            .json(&EnrollRequest {
                kind: DeviceKind::Kart,
                requested_id: requested_id.to_owned(),
                csr,
            })
            .send()
            .await
            .map_err(|e| {
                anyhow!(
                    "enrollment service not reachable at {origin}: {}",
                    root_cause(&e)
                )
            })?;
        let ticket: EnrollTicket = parse(res).await?;
        let pending = Pending {
            origin: origin.to_owned(),
            requested_id: requested_id.to_owned(),
            request_id: ticket.request_id,
            code: ticket.code,
            expires_at_s: ticket.expires_at_s,
            key_pem: key.serialize_pem(),
        };
        write_private(
            &self.dir.join("pending.json"),
            &serde_json::to_vec(&pending)?,
        )?;
        info!(code = %pending.code, requested_id, "enrollment requested; waiting for approval");
        self.spawn_poll(pending, extra_ca);
        Ok(())
    }

    /// Cancels a pending request.
    pub fn cancel(&self) {
        self.abort();
        self.clear_pending();
        self.report(None);
    }

    fn abort(&self) {
        if let Some(t) = self.task.lock().expect("task").take() {
            t.abort();
        }
    }

    fn clear_pending(&self) {
        let _ = fs::remove_file(self.dir.join("pending.json"));
    }

    fn spawn_poll(self: &Arc<Self>, p: Pending, extra_ca: Option<String>) {
        self.report_pending(&p, None);
        let me = self.clone();
        let task = tokio::spawn(async move {
            let outcome = me.poll(&p, extra_ca.as_deref()).await;
            me.clear_pending();
            match outcome {
                Ok(id) => {
                    info!(device_id = %id.device_id, "enrolled");
                    me.report(None);
                    me.changed.send_modify(|n| *n += 1);
                }
                Err(e) => {
                    warn!("enrollment: {e:#}");
                    me.report(Some(format!("{e:#}")));
                }
            }
        });
        *self.task.lock().expect("task") = Some(task);
    }

    async fn poll(&self, p: &Pending, extra_ca: Option<&str>) -> Result<Identity> {
        let http = http_client(extra_ca)?;
        let url = format!("{}{REQUESTS_PATH}/{}", p.origin, p.request_id);
        loop {
            if now_s() > p.expires_at_s {
                bail!("the request expired without approval; enroll again");
            }
            match http.get(&url).send().await {
                Ok(res) if res.status() == reqwest::StatusCode::NOT_FOUND => {
                    bail!(
                        "the enrollment service forgot the request (expired or restarted); enroll again"
                    )
                }
                Ok(res) => match parse::<EnrollState>(res).await {
                    Ok(EnrollState::Pending { .. }) => self.report_pending(p, None),
                    Ok(EnrollState::Approved(creds)) => {
                        return Identity::store(&self.dir, &creds, &p.key_pem);
                    }
                    Ok(EnrollState::Rejected) => bail!("rejected by an admin"),
                    Err(e) => self.report_pending(p, Some(format!("{e:#}"))),
                },
                Err(e) => self.report_pending(
                    p,
                    Some(format!("service not reachable: {}", root_cause(&e))),
                ),
            }
            tokio::time::sleep(POLL).await;
        }
    }

    fn base_status(&self) -> EnrollmentStatus {
        match Identity::load(&self.dir) {
            Ok(Some(id)) => EnrollmentStatus {
                state: "enrolled".into(),
                device_id: Some(id.device_id),
                not_after_s: Some(id.not_after_s),
                ..Default::default()
            },
            Ok(None) => EnrollmentStatus {
                state: "none".into(),
                ..Default::default()
            },
            Err(e) => EnrollmentStatus {
                state: "none".into(),
                error: Some(format!("stored identity unreadable: {e:#}")),
                ..Default::default()
            },
        }
    }

    fn report(&self, error: Option<String>) {
        let mut st = self.base_status();
        if error.is_some() {
            st.error = error;
        }
        self.shared.update(|s| s.enrollment = st);
    }

    fn report_pending(&self, p: &Pending, error: Option<String>) {
        let mut st = self.base_status();
        st.state = "pending".into();
        st.code = Some(p.code.clone());
        st.expires_at_s = Some(p.expires_at_s);
        st.requested_id = Some(p.requested_id.clone());
        st.error = error;
        self.shared.update(|s| s.enrollment = st);
    }
}

/// `https://host[:port]` from a `wss://host[:port]/path` broker URL (`ws` → `http`).
pub fn origin_of(broker_url: &str) -> Option<String> {
    let (scheme, rest) = broker_url.split_once("://")?;
    let scheme = match scheme {
        "wss" => "https",
        "ws" => "http",
        _ => return None,
    };
    let host = rest.split('/').next().filter(|h| !h.is_empty())?;
    Some(format!("{scheme}://{host}"))
}

fn http_client(extra_ca: Option<&str>) -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .use_preconfigured_tls(kart_mqtt::tls::server_config(extra_ca)?)
        .timeout(Duration::from_secs(10))
        .build()?)
}

async fn parse<T: serde::de::DeserializeOwned>(res: reqwest::Response) -> Result<T> {
    let status = res.status();
    if status.is_success() {
        return res
            .json()
            .await
            .context("unexpected answer from the enrollment service");
    }
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    match body["error"].as_str() {
        Some(msg) => bail!("{msg}"),
        None if status == reqwest::StatusCode::FORBIDDEN => {
            bail!("enrollment is only possible from the lab network (HTTP 403)")
        }
        None => bail!("enrollment service answered {status}"),
    }
}

fn root_cause(e: &(dyn std::error::Error + 'static)) -> String {
    let mut cur = e;
    while let Some(next) = cur.source() {
        cur = next;
    }
    cur.to_string()
}

fn read_pending(dir: &Path) -> Result<Option<Pending>> {
    let path = dir.join("pending.json");
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Writes atomically with mode 0600.
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .with_context(|| format!("writing {}", tmp.display()))?;
    f.write_all(bytes)?;
    f.sync_all()?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn now_s() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins() {
        assert_eq!(
            origin_of("wss://kart.example.org/mqtt").as_deref(),
            Some("https://kart.example.org")
        );
        assert_eq!(
            origin_of("wss://h:8443/mqtt").as_deref(),
            Some("https://h:8443")
        );
        assert_eq!(
            origin_of("ws://localhost:9002").as_deref(),
            Some("http://localhost:9002")
        );
        assert_eq!(origin_of("mqtt://10.0.0.1:1883"), None);
        assert_eq!(origin_of("wss:///mqtt"), None);
    }
}
