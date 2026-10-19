use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use kart_agent::{
    api::{self, ApiState, Control},
    config::{self, Sources},
    status::Shared,
};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tower::ServiceExt;

fn setup(name: &str) -> (axum::Router, mpsc::UnboundedReceiver<Control>) {
    let dir = std::env::temp_dir().join(format!("kart-agent-api-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for d in ["etc", "state"] {
        fs::create_dir_all(dir.join(d)).unwrap();
    }
    let sources = Sources::new(&dir.join("etc"), &dir.join("state"), None::<PathBuf>);
    let (tx, rx) = mpsc::unbounded_channel();
    let shared = Arc::new(Shared::default());
    Shared::beat(&shared.pipeline_heartbeat_ms);
    Shared::beat(&shared.log_heartbeat_ms);
    let state = Arc::new(ApiState {
        shared,
        config: Mutex::new(config::load(&sources).unwrap()),
        sources,
        control: tx,
        allow_remote: false,
    });
    (api::router(state), rx)
}

async fn call(
    app: &axum::Router,
    method: &str,
    host: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri("/v1/config")
        .header(header::HOST, host);
    if body.is_some() {
        req = req.header(header::CONTENT_TYPE, "application/json");
    }
    let body = body.map_or(Body::empty(), |b| Body::from(b.to_string()));
    let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

const HOST: &str = "127.0.0.1:7411";

#[tokio::test]
async fn rejects_foreign_hosts() {
    let (app, _) = setup("host");
    assert_eq!(
        call(&app, "GET", "evil.example:7411", None).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "GET", "localhost:7411", None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn live_toggle_applies_without_restart() {
    let (app, mut control) = setup("toggle");
    let (status, body) = call(&app, "PUT", HOST, Some(json!({"live": {"enabled": false}}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["restart_required"], false);
    assert_eq!(body["effective"]["live"]["enabled"], false);
    assert_eq!(control.recv().await, Some(Control::Live(false)));
}

#[tokio::test]
async fn other_changes_restart_the_pipeline() {
    let (app, mut control) = setup("restart");
    let (status, body) = call(&app, "PUT", HOST, Some(json!({"kart_id": "kart-02"}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["restart_required"], true);
    assert_eq!(control.recv().await, Some(Control::Restart));
    let (_, body) = call(&app, "GET", HOST, None).await;
    assert_eq!(body["overrides"], json!({"kart_id": "kart-02"}));
}

#[tokio::test]
async fn invalid_patches_are_rejected() {
    let (app, _) = setup("invalid");
    let (status, body) = call(&app, "PUT", HOST, Some(json!({"live": {"batch_ms": 5}}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(body["error"].as_str().unwrap().contains("batch_ms"));

    // Without a JSON content type (what a cross-site form could send).
    let req = Request::builder()
        .method("PUT")
        .uri("/v1/config")
        .header(header::HOST, HOST)
        .body(Body::from(r#"{"kart_id": "x"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}
