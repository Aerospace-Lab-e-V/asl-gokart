//! The two HTTP faces of the service:
//!
//! - **public** (`--public-listen`, behind the border Nginx at `/enroll/`): devices submit
//!   requests and poll them, see [`enroll_proto`]. It can only queue requests.
//! - **admin** (`--admin-listen`, loopback inside the container): list, approve, reject,
//!   disable. Used by the CLI through `docker exec` (`kart-enroll` on the VM); later by
//!   the management interface.

use std::{fs::OpenOptions, io::Write, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{ConnectInfo, DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use enroll_proto::{
    Credentials, DeviceKind, EnrollRequest, EnrollTicket, client_id, validate_device_id,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::{
    ca::{self, DeviceCa},
    dynsec::{Acl, Dynsec},
    store::{self, Outcome, Store},
};

pub struct App {
    pub store: Store,
    pub ca: DeviceCa,
    pub dynsec: Dynsec,
    pub cert_days: i64,
    pub data_dir: PathBuf,
    /// One approval at a time: two approvals for the same ID must not interleave.
    pub approving: Mutex<()>,
}

/// Internal broker users the service keeps in the plugin; passwords from the environment.
pub struct InternalUsers {
    pub ingest_password: Option<String>,
    pub ingest_client_id: String,
    pub pit_wall_password: Option<String>,
}

pub const TIMING_ROLE: &str = "timing";
const KART_ROLE_PREFIX: &str = "kart:";

pub fn kart_role(kart_id: &str) -> String {
    format!("{KART_ROLE_PREFIX}{kart_id}")
}

/// A kart publishes and subscribes under its own `kart/<id>/` only.
pub fn kart_acls(kart_id: &str) -> Vec<Acl> {
    let t = |s: &str| format!("kart/{kart_id}/{s}");
    let mut acls: Vec<Acl> = ["live", "status", "backfill", "alerts", "cmd/ack", "driver"]
        .iter()
        .map(|s| Acl::allow("publishClientSend", t(s)))
        .collect();
    acls.extend(
        ["cmd", "profile"]
            .iter()
            .map(|s| Acl::allow("subscribePattern", t(s))),
    );
    acls
}

fn timing_acls() -> Vec<Acl> {
    vec![
        Acl::allow("publishClientSend", "kart/+/laps"),
        Acl::allow("subscribePattern", "kart/+/live"),
        Acl::allow("subscribePattern", "kart/+/status"),
    ]
}

fn subscriber_acls(suffixes: &[&str]) -> Vec<Acl> {
    suffixes
        .iter()
        .map(|s| Acl::allow("subscribePattern", format!("kart/+/{s}")))
        .collect()
}

/// Brings roles and internal users to the state this version expects. Runs on every start,
/// so ACL changes in a new release reach the broker.
pub async fn bootstrap(d: &Dynsec, users: &InternalUsers) -> Result<()> {
    d.ensure_role(TIMING_ROLE, &timing_acls()).await?;
    d.ensure_role(
        "ingest",
        &subscriber_acls(&["live", "status", "laps", "backfill", "alerts"]),
    )
    .await?;
    d.ensure_role("pit-wall", &subscriber_acls(&["live", "status", "laps"]))
        .await?;
    if let Some(pw) = &users.ingest_password {
        d.ensure_client(
            "ingest",
            pw,
            Some(&users.ingest_client_id),
            &["ingest"],
            "internal: ingest",
        )
        .await?;
    }
    if let Some(pw) = &users.pit_wall_password {
        // Browsers pick random client IDs, so this user cannot be pinned (see ADR-0004).
        d.ensure_client(
            "pit-wall",
            pw,
            None,
            &["pit-wall"],
            "internal: pit wall (read-only)",
        )
        .await?;
    }
    for c in d.list_clients().await? {
        for role in &c.roles {
            if let Some(kart) = role.rolename.strip_prefix(KART_ROLE_PREFIX) {
                d.ensure_role(&role.rolename, &kart_acls(kart)).await?;
            }
        }
    }
    Ok(())
}

pub fn public_router(app: Arc<App>) -> Router {
    Router::new()
        .route(enroll_proto::REQUESTS_PATH, post(submit))
        .route(
            &format!("{}/{{id}}", enroll_proto::REQUESTS_PATH),
            get(poll),
        )
        .route("/enroll/v1/health", get(|| async { "ok" }))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(app)
}

pub fn admin_router(app: Arc<App>) -> Router {
    Router::new()
        .route("/admin/requests", get(list_requests))
        .route("/admin/requests/{code}/approve", post(approve))
        .route("/admin/requests/{code}/reject", post(reject))
        .route("/admin/devices", get(list_devices))
        .route("/admin/devices/{id}/{action}", post(set_device))
        .route(
            "/admin/ca",
            get(|State(app): State<Arc<App>>| async move { app.ca.cert_pem.clone() }),
        )
        .with_state(app)
}

struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, msg.into())
}

fn internal(e: anyhow::Error) -> ApiError {
    warn!("{e:#}");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"))
}

/// The requester's address: the border Nginx sets `X-Real-IP`.
fn source(headers: &HeaderMap, peer: SocketAddr) -> String {
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| peer.ip().to_string())
}

async fn submit(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<EnrollRequest>,
) -> Result<(StatusCode, Json<EnrollTicket>), ApiError> {
    validate_device_id(req.kind, &req.requested_id).map_err(bad)?;
    ca::parse_csr(&req.csr).map_err(|e| bad(format!("{e:#}")))?;
    let src = source(&headers, peer);
    let r = app
        .store
        .add(req.kind, req.requested_id, req.csr, src)
        .map_err(|e| ApiError(StatusCode::TOO_MANY_REQUESTS, e.to_string()))?;
    info!(code = %r.code, kind = ?r.kind, requested_id = %r.requested_id, source = %r.source, "enrollment requested");
    Ok((
        StatusCode::CREATED,
        Json(EnrollTicket {
            request_id: r.request_id,
            code: r.code,
            expires_at_s: r.expires_at_s,
        }),
    ))
}

async fn poll(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    match app.store.state(&id) {
        Some(state) => Json(state).into_response(),
        None => {
            ApiError(StatusCode::NOT_FOUND, "unknown or expired request".into()).into_response()
        }
    }
}

async fn list_requests(State(app): State<Arc<App>>) -> Json<Vec<store::Summary>> {
    Json(app.store.list())
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Approval {
    /// Assign another ID than the requested one.
    #[serde(default)]
    pub device_id: Option<String>,
    /// Re-enroll an existing device: its old certificate's broker login stops working.
    #[serde(default)]
    pub replace: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Approved {
    pub device_id: String,
    pub kind: DeviceKind,
    pub serial: String,
    pub not_after_s: i64,
}

async fn approve(
    State(app): State<Arc<App>>,
    Path(code): Path<String>,
    body: Option<Json<Approval>>,
) -> Result<Json<Approved>, ApiError> {
    let approval = body.map(|Json(b)| b).unwrap_or_default();
    let _one_at_a_time = app.approving.lock().await;
    let req = app.store.pending_by_code(&code).ok_or_else(|| {
        ApiError(
            StatusCode::NOT_FOUND,
            format!("no pending request with code {code}"),
        )
    })?;
    let id = approval
        .device_id
        .unwrap_or_else(|| req.requested_id.clone());
    validate_device_id(req.kind, &id).map_err(bad)?;
    let existing = app.dynsec.get_client(&id).await.map_err(internal)?;
    if existing.is_some() && !approval.replace {
        return Err(ApiError(
            StatusCode::CONFLICT,
            format!(
                "{id} is already enrolled; approve with --replace to re-enroll it (its current login stops working)"
            ),
        ));
    }
    let csr = ca::parse_csr(&req.csr).map_err(internal)?;
    let role = match req.kind {
        DeviceKind::Kart => {
            let role = kart_role(&id);
            app.dynsec
                .ensure_role(&role, &kart_acls(&id))
                .await
                .map_err(internal)?;
            role
        }
        DeviceKind::Timing => TIMING_ROLE.to_owned(),
    };
    let password = store::random_hex(20).map_err(internal)?;
    let mqtt_client_id = client_id(req.kind, &id);
    let kind_name = match req.kind {
        DeviceKind::Kart => "kart",
        DeviceKind::Timing => "timing device",
    };
    app.dynsec
        .ensure_client(
            &id,
            &password,
            Some(&mqtt_client_id),
            &[&role],
            &format!("device: {kind_name}"),
        )
        .await
        .map_err(internal)?;
    let signed = app.ca.sign(&csr, &id, app.cert_days).map_err(internal)?;
    let not_after_s = signed.not_after.unix_timestamp();
    let creds = Credentials {
        device_id: id.clone(),
        certificate: signed.pem,
        ca_certificate: app.ca.cert_pem.clone(),
        not_after_s,
        mqtt_username: id.clone(),
        mqtt_password: password,
        mqtt_client_id,
    };
    if !app
        .store
        .decide(&req.request_id, Outcome::Approved(Box::new(creds)))
    {
        return Err(ApiError(
            StatusCode::GONE,
            "the request expired meanwhile; let the device start over".into(),
        ));
    }
    let record = json!({
        "time_s": store::now_s(), "event": "issued", "device_id": id, "kind": req.kind,
        "serial": signed.serial_hex, "not_after_s": not_after_s, "code": req.code,
        "requested_id": req.requested_id, "source": req.source, "replaced": existing.is_some(),
    });
    if let Err(e) = append_record(&app.data_dir, &record) {
        warn!("writing the issue log: {e:#}");
    }
    info!(device_id = %id, kind = ?req.kind, serial = %signed.serial_hex, "enrollment approved");
    Ok(Json(Approved {
        device_id: id,
        kind: req.kind,
        serial: signed.serial_hex,
        not_after_s,
    }))
}

async fn reject(
    State(app): State<Arc<App>>,
    Path(code): Path<String>,
) -> Result<StatusCode, ApiError> {
    let req = app.store.pending_by_code(&code).ok_or_else(|| {
        ApiError(
            StatusCode::NOT_FOUND,
            format!("no pending request with code {code}"),
        )
    })?;
    app.store.decide(&req.request_id, Outcome::Rejected);
    info!(code = %req.code, requested_id = %req.requested_id, "enrollment rejected");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Device {
    pub device_id: String,
    pub kind: DeviceKind,
    pub client_id: Option<String>,
    pub disabled: bool,
}

async fn list_devices(State(app): State<Arc<App>>) -> Result<Json<Vec<Device>>, ApiError> {
    let clients = app.dynsec.list_clients().await.map_err(internal)?;
    let mut devices: Vec<Device> = clients
        .into_iter()
        .filter_map(|c| {
            let kind = if c
                .roles
                .iter()
                .any(|r| r.rolename.starts_with(KART_ROLE_PREFIX))
            {
                DeviceKind::Kart
            } else if c.roles.iter().any(|r| r.rolename == TIMING_ROLE) {
                DeviceKind::Timing
            } else {
                return None;
            };
            Some(Device {
                device_id: c.username,
                kind,
                client_id: c.clientid,
                disabled: c.disabled,
            })
        })
        .collect();
    devices.sort_by(|a, b| a.device_id.cmp(&b.device_id));
    Ok(Json(devices))
}

async fn set_device(
    State(app): State<Arc<App>>,
    Path((id, action)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let enabled = match action.as_str() {
        "enable" => true,
        "disable" => false,
        _ => return Err(ApiError(StatusCode::NOT_FOUND, "unknown action".into())),
    };
    let devices = list_devices(State(app.clone())).await?.0;
    if !devices.iter().any(|d| d.device_id == id) {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            format!("no enrolled device {id}"),
        ));
    }
    app.dynsec
        .set_enabled(&id, enabled)
        .await
        .map_err(internal)?;
    let _ = append_record(
        &app.data_dir,
        &json!({ "time_s": store::now_s(), "event": action, "device_id": id }),
    );
    info!(device_id = %id, enabled, "device switched");
    Ok(StatusCode::NO_CONTENT)
}

fn append_record(dir: &std::path::Path, record: &serde_json::Value) -> Result<()> {
    let path = dir.join("issued.jsonl");
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("opening {}", path.display()))?;
    writeln!(f, "{record}")?;
    Ok(())
}

/// Retries [`bootstrap`] until it succeeds: the broker may start after us.
pub async fn bootstrap_until_done(d: &Dynsec, users: &InternalUsers) {
    let mut delay = Duration::from_secs(1);
    loop {
        match bootstrap(d, users).await {
            Ok(()) => {
                info!("broker roles and internal users are up to date");
                return;
            }
            Err(e) => {
                warn!("preparing the broker: {e:#}; retrying in {delay:?}");
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(30));
            }
        }
    }
}
