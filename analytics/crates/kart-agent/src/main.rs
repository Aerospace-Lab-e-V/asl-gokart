use std::{
    fs,
    io::IsTerminal,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};

use anyhow::{Context as _, Result};
use clap::Parser;
use kart_agent::{
    agent::{self, Context, Exit},
    config::{self, Sources},
    session::{self, Session},
    status::Shared,
    systemd,
};
use tracing::{error, info};

/// Directory defaults match the systemd unit, which also sets the variables.
#[derive(Parser)]
#[command(version = agent::VERSION, about)]
struct Args {
    /// Logs and API-written configuration.
    #[arg(long, env = "STATE_DIRECTORY", default_value = "/var/lib/kart-agent")]
    state_dir: PathBuf,

    /// Session state; must survive agent restarts but not reboots (tmpfs).
    #[arg(long, env = "RUNTIME_DIRECTORY", default_value = "/run/kart-agent")]
    runtime_dir: PathBuf,

    /// Optional admin configuration (`agent.toml`).
    #[arg(
        long,
        env = "CONFIGURATION_DIRECTORY",
        default_value = "/etc/kart-agent"
    )]
    config_dir: PathBuf,

    /// Extra TOML layer on top of everything else (development).
    #[arg(long, env = "KART_AGENT_CONFIG")]
    config: Option<PathBuf>,

    /// Allow a non-loopback API address and any Host header (containers only).
    #[arg(long, env = "KART_AGENT_API_ALLOW_REMOTE")]
    api_allow_remote: bool,

    #[arg(long, hide = true, default_value = session::BOOT_ID_PATH)]
    boot_id_path: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        // journald adds its own timestamps.
        .with_ansi(std::io::stdout().is_terminal())
        .init();
    let args = Args::parse();

    for dir in [&args.state_dir, &args.runtime_dir] {
        fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    let session = Session::open(&args.runtime_dir, &args.boot_id_path)?;
    info!(
        version = agent::VERSION,
        session = session.id(),
        run = session.runs(),
        "starting"
    );

    let shared = Arc::new(Shared::default());
    systemd::spawn_watchdog(shared.clone());
    let ctx = Context {
        sources: Sources::new(&args.config_dir, &args.state_dir, args.config.clone()),
        state_dir: args.state_dir.clone(),
        shared,
        session: Arc::new(Mutex::new(session)),
        started: Instant::now(),
        allow_remote_api: args.api_allow_remote,
    };

    loop {
        let loaded = config::load(&ctx.sources)?;
        match agent::run(&ctx, loaded).await {
            Ok(Exit::Restart) => continue,
            Ok(Exit::Stop) => break,
            Err(e) => {
                error!("{e:#}");
                systemd::stopping();
                return Err(e);
            }
        }
    }
    systemd::stopping();
    info!("stopped");
    Ok(())
}
