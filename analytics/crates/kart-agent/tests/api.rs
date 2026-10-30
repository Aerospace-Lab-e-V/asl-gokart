//! The local API through its router. `fixtures/stream.sse` is the contract for
//! `GET /v1/stream`: the headunit's agent adapter parses it in its unit tests. The
//! `stream_fixture` test fails when the encoding changes without the fixture; regenerate
//! it with
//!   UPDATE_FIXTURES=1 cargo test -p kart-agent --test api stream_fixture
//! and update the headunit's adapter if needed.

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use futures_util::StreamExt;
use kart_agent::{
    api::{self, ApiState, Control},
    config::{self, Sources},
    status::Shared,
    stream::Tap,
};
use serde_json::{Value, json};
use telemetry_schema::{ids, v1::Sample};
use tokio::sync::{mpsc, watch};
use tower::ServiceExt;

fn setup(name: &str) -> (axum::Router, mpsc::UnboundedReceiver<Control>) {
    let (app, control, _, _) = setup_stream(name);
    (app, control)
}

fn setup_stream(
    name: &str,
) -> (
    axum::Router,
    mpsc::UnboundedReceiver<Control>,
    Arc<Tap>,
    watch::Sender<bool>,
) {
    let dir = std::env::temp_dir().join(format!("kart-agent-api-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for d in ["etc", "state"] {
        fs::create_dir_all(dir.join(d)).unwrap();
    }
    let sources = Sources::new(&dir.join("etc"), &dir.join("state"), None::<PathBuf>);
    let (tx, rx) = mpsc::unbounded_channel();
    let shared = Arc::new(Shared::default());
    let tap = Arc::new(Tap::default());
    let (stop, stopped) = watch::channel(false);
    Shared::beat(&shared.pipeline_heartbeat_ms);
    Shared::beat(&shared.log_heartbeat_ms);
    let state = Arc::new(ApiState {
        shared,
        config: Mutex::new(config::load(&sources).unwrap()),
        sources,
        control: tx,
        allow_remote: false,
        tap: tap.clone(),
        stop: stopped,
    });
    (api::router(state), rx, tap, stop)
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

fn sample(signal_id: u32, t_us: i64, value: f64) -> Sample {
    Sample {
        signal_id,
        t_us,
        value,
    }
}

/// One GPS epoch (Herrenberg) and a battery voltage from just before it.
fn recorded() -> Vec<Sample> {
    let t = 1_792_400_001_000_000;
    vec![
        sample(ids::BATTERY_VOLTAGE, t - 100_000, 67.2),
        sample(ids::GPS_LAT, t, 48.594_12),
        sample(ids::GPS_LON, t, 8.866_05),
        sample(ids::GPS_HEADING, t, 87.5),
        sample(ids::GPS_SPEED, t, 42.3),
        sample(ids::GPS_ALTITUDE, t, 412.5),
        sample(ids::GPS_FIX, t, 3.0),
        sample(ids::GPS_SATELLITES, t, 9.0),
        sample(ids::GPS_HDOP, t, 0.9),
    ]
}

fn stream_request() -> Request<Body> {
    Request::builder()
        .uri("/v1/stream")
        .header(header::HOST, HOST)
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn stream_fixture() {
    let (app, _, tap, stop) = setup_stream("stream-fixture");
    tap.push(&recorded());
    // Stopped before the request: the snapshot, then the end of the body.
    stop.send(true).unwrap();
    let res = app.oneshot(stream_request()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "text/event-stream");
    let body = tokio::time::timeout(Duration::from_secs(5), to_bytes(res.into_body(), 1 << 20))
        .await
        .expect("the stream ends when the API stops")
        .unwrap();
    let body = String::from_utf8(body.to_vec()).unwrap();

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/stream.sse");
    if std::env::var_os("UPDATE_FIXTURES").is_some() {
        fs::write(path, &body).unwrap();
    }
    let fixture = fs::read_to_string(path).expect("run with UPDATE_FIXTURES=1 once");
    assert_eq!(fixture, body, "fixture out of date, see the module docs");
}

async fn next_event(body: &mut axum::body::BodyDataStream) -> Option<String> {
    tokio::time::timeout(Duration::from_secs(5), body.next())
        .await
        .expect("no event within 5 s")
        .map(|chunk| String::from_utf8(chunk.unwrap().to_vec()).unwrap())
}

#[tokio::test]
async fn stream_sends_the_snapshot_then_live_samples_until_stopped() {
    let (app, _, tap, stop) = setup_stream("stream-live");
    tap.push(&[sample(ids::GPS_FIX, 1, 3.0)]);
    let res = app.oneshot(stream_request()).await.unwrap();
    let mut body = res.into_body().into_data_stream();
    assert_eq!(
        next_event(&mut body).await.unwrap(),
        "event: samples\ndata: {\"t_us\":1,\"samples\":{\"gps.fix\":3.0}}\n\n"
    );
    tap.push(&[sample(ids::GPS_SPEED, 2, 12.5)]);
    assert!(
        next_event(&mut body)
            .await
            .unwrap()
            .contains(r#""gps.speed":12.5"#)
    );
    stop.send(true).unwrap();
    assert_eq!(next_event(&mut body).await, None);
}
