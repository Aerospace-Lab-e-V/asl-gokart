//! Wiring: one [`run`] per configuration. A configuration change ends the run with
//! [`Exit::Restart`] and `main` starts a new one in the same session.

use std::{
    future::IntoFuture,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context as _, Result, bail};
use serde_json::json;
use tokio::{
    net::TcpListener,
    sync::{broadcast, mpsc, watch},
};
use tracing::info;

use crate::{
    api::{self, ApiState, Control},
    clock,
    config::{Loaded, Sources},
    gps,
    log::{LogWriter, SessionInfo},
    pipeline::Pipeline,
    sero,
    session::Session,
    status::Shared,
    systemd,
};

pub const VERSION: &str = match option_env!("KART_AGENT_VERSION") {
    Some(v) => v,
    None => concat!(env!("CARGO_PKG_VERSION"), "-dev"),
};

/// Everything that outlives a single run.
pub struct Context {
    pub state_dir: PathBuf,
    pub sources: Sources,
    pub shared: Arc<Shared>,
    pub session: Arc<Mutex<Session>>,
    pub started: Instant,
    pub allow_remote_api: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    Stop,
    Restart,
}

pub async fn run(ctx: &Context, loaded: Loaded) -> Result<Exit> {
    let cfg = loaded.effective.clone();
    let listen: SocketAddr = cfg
        .api
        .listen
        .parse()
        .with_context(|| format!("api.listen {:?}", cfg.api.listen))?;
    if !listen.ip().is_loopback() && !ctx.allow_remote_api {
        bail!("api.listen must be a loopback address (or run with --api-allow-remote)");
    }

    ctx.shared.update(|s| {
        s.agent.version = VERSION.into();
        s.agent.restart_pending = false;
        let session = ctx.session.lock().expect("session lock");
        s.agent.runs = session.runs();
        s.session.id = session.id().into();
        s.session.boot_id = session.boot_id().into();
    });

    let (control_tx, mut control_rx) = mpsc::unbounded_channel();
    let api_state = Arc::new(ApiState {
        shared: ctx.shared.clone(),
        sources: ctx.sources.clone(),
        config: Mutex::new(loaded),
        control: control_tx,
        allow_remote: ctx.allow_remote_api,
    });
    let listener = TcpListener::bind(listen)
        .await
        .with_context(|| format!("binding the API to {listen}"))?;
    let (stop_api, api_stopped) = tokio::sync::oneshot::channel::<()>();
    let api = tokio::spawn(
        axum::serve(listener, api::router(api_state))
            .with_graceful_shutdown(async {
                let _ = api_stopped.await;
            })
            .into_future(),
    );
    info!(%listen, kart_id = %cfg.kart_id, "API listening");

    // Log first: everything else reports into it.
    let (session_info, first_seq) = {
        let session = ctx.session.lock().expect("session lock");
        let info = SessionInfo {
            kart_id: cfg.kart_id.clone(),
            session_id: session.id().into(),
            boot_id: session.boot_id().into(),
            agent_version: VERSION.into(),
            run: session.runs(),
        };
        (info, session.next_seq())
    };
    let (writer, log) = LogWriter::spawn(
        &ctx.state_dir,
        session_info,
        first_seq,
        cfg.log.clone(),
        cfg.retention.clone(),
        ctx.shared.clone(),
    )
    .context("starting the log writer")?;
    log.event(
        "agent.started",
        json!({ "version": VERSION, "config": &cfg }),
    );

    // ECUs and GPS → samples → pipeline. The pipeline ends when both providers have
    // closed the channel, so on shutdown everything received is still written.
    let (stop_provider, provider_stop) = watch::channel(false);
    let (live_tx, live_rx) = watch::channel(cfg.live.enabled);
    let (samples_tx, samples_rx) = mpsc::channel(1024);
    let gps = tokio::spawn(
        gps::Provider::new(
            cfg.gps.clone(),
            ctx.shared.clone(),
            samples_tx.clone(),
            log.clone(),
        )
        .run(provider_stop.clone()),
    );
    let provider = tokio::spawn(
        sero::Provider::new(
            cfg.sero.clone(),
            &cfg.vehicle,
            ctx.shared.clone(),
            samples_tx,
            log.clone(),
        )
        .run(provider_stop),
    );
    let (stream, _) = broadcast::channel(64);
    let pipeline = tokio::spawn(
        Pipeline {
            cfg: cfg.clone(),
            session: ctx.session.clone(),
            shared: ctx.shared.clone(),
            log: log.clone(),
            stream,
        }
        .run(samples_rx, live_rx),
    );

    systemd::ready();
    systemd::status(&format!("kart {}", cfg.kart_id));

    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);
    let mut status_tick = tokio::time::interval(Duration::from_secs(1));
    let exit = loop {
        tokio::select! {
            _ = &mut shutdown => break Exit::Stop,
            Some(control) = control_rx.recv() => match control {
                Control::Restart => break Exit::Restart,
                Control::Live(enabled) => {
                    let _ = live_tx.send(enabled);
                }
            },
            _ = status_tick.tick() => {
                ctx.shared.update(|s| {
                    s.agent.uptime_s = ctx.started.elapsed().as_secs();
                    s.clock = clock::status();
                });
            }
        }
    };

    info!(?exit, "stopping the pipeline");
    let _ = stop_provider.send(true);
    let _ = provider.await;
    let _ = gps.await;
    let _ = pipeline.await;
    log.event("agent.stopped", json!({ "exit": format!("{exit:?}") }));
    drop(log);
    let _ = tokio::task::spawn_blocking(move || writer.stop()).await;

    let _ = stop_api.send(());
    let _ = api.await;
    Ok(exit)
}

async fn shutdown_signal() {
    use tokio::signal::unix::{SignalKind, signal};
    let mut term = signal(SignalKind::terminate()).expect("installing SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}
