//! Local HTTP API for the headunit (loopback only):
//!
//! - `GET /v1/health`: 200 while the agent's loops run, 503 otherwise
//! - `GET /v1/status`: [`crate::status::Status`]
//! - `GET /v1/config`: effective configuration and the API-owned overrides
//! - `PUT /v1/config`: JSON merge patch (RFC 7396) on the overrides; `null` removes one.
//!   `live.enabled` applies immediately, anything else restarts the agent's pipeline
//!   within the same session.
//! - `GET /v1/stream`: Server-Sent Events with the live samples, see [`crate::stream`].
//!   A restart ends it; the client reconnects.
//!
//! There is no authentication: the API listens on loopback and rejects requests whose
//! `Host` is not loopback (DNS rebinding). It sends no CORS headers and only accepts
//! `application/json` bodies, so a web page can neither change the configuration nor
//! read the stream.

use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response,
        sse::{KeepAlive, Sse},
    },
    routing::get,
};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};
use tracing::info;

use crate::{
    config::{self, Loaded, Sources},
    status::Shared,
    stream::{self, Tap},
    systemd,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control {
    /// Re-read the configuration and restart the pipeline.
    Restart,
    /// Switch the live uplink on or off.
    Live(bool),
}

pub struct ApiState {
    pub shared: Arc<Shared>,
    pub sources: Sources,
    pub config: Mutex<Loaded>,
    pub control: mpsc::UnboundedSender<Control>,
    /// Accept any `Host` (the agent runs in a container and is published on a port).
    pub allow_remote: bool,
    pub tap: Arc<Tap>,
    /// Set when the API shuts down; ends open streams.
    pub stop: watch::Receiver<bool>,
}

#[derive(Serialize)]
struct ConfigReply<'a> {
    #[serde(flatten)]
    loaded: &'a Loaded,
    restart_required: bool,
}

pub fn router(state: Arc<ApiState>) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/status", get(status))
        .route("/v1/config", get(get_config).put(put_config))
        .route("/v1/stream", get(live_stream))
        .layer(middleware::from_fn_with_state(state.clone(), loopback_host))
        .with_state(state)
}

async fn health(State(s): State<Arc<ApiState>>) -> StatusCode {
    if s.shared.healthy(5_000) {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

async fn status(State(s): State<Arc<ApiState>>) -> impl IntoResponse {
    Json(s.shared.snapshot())
}

async fn live_stream(State(s): State<Arc<ApiState>>) -> impl IntoResponse {
    Sse::new(stream::events(s.tap.clone(), s.stop.clone())).keep_alive(KeepAlive::default())
}

async fn get_config(State(s): State<Arc<ApiState>>) -> Response {
    let loaded = s.config.lock().expect("config lock").clone();
    Json(ConfigReply {
        loaded: &loaded,
        restart_required: false,
    })
    .into_response()
}

async fn put_config(State(s): State<Arc<ApiState>>, Json(patch): Json<Value>) -> Response {
    let new = match config::apply_patch(&s.sources, patch) {
        Ok(new) => new,
        Err(e) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({ "error": format!("{e:#}") })),
            )
                .into_response();
        }
    };
    let old = std::mem::replace(&mut *s.config.lock().expect("config lock"), new.clone());
    let changed = old.effective != new.effective;
    let hot = old.effective.differs_only_in_live_toggle(&new.effective);
    if changed && hot {
        let _ = s.control.send(Control::Live(new.effective.live.enabled));
    } else if changed {
        info!("configuration changed, restarting the pipeline");
        s.shared.update(|st| st.agent.restart_pending = true);
        let control = s.control.clone();
        tokio::spawn(async move {
            tokio::time::sleep(systemd::RESTART_DELAY).await;
            let _ = control.send(Control::Restart);
        });
    }
    Json(ConfigReply {
        loaded: &new,
        restart_required: changed && !hot,
    })
    .into_response()
}

async fn loopback_host(State(s): State<Arc<ApiState>>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    let name = host.rsplit_once(':').map_or(host, |(name, _)| name);
    if s.allow_remote || matches!(name, "127.0.0.1" | "localhost" | "[::1]") {
        next.run(req).await
    } else {
        (StatusCode::FORBIDDEN, "loopback only").into_response()
    }
}
