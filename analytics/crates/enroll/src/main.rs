//! Device enrollment (ADR-0004). `enroll serve` runs the service; the other subcommands
//! are the admin CLI. On the VM they run inside the container (`kart-enroll <command>`,
//! installed by `deploy/vm/install.sh`), where the admin API is reachable on loopback.

mod ca;
mod dynsec;
mod server;
mod store;

use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use serde::de::DeserializeOwned;
use tokio::net::TcpListener;
use tracing::info;

#[derive(Parser)]
#[command(
    version,
    about = "Device enrollment: device CA, approval by code, per-device broker users"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
    /// Admin API of the running service (for the CLI subcommands).
    #[arg(
        long,
        env = "ENROLL_ADMIN_URL",
        default_value = "http://127.0.0.1:8083",
        global = true
    )]
    admin_url: String,
}

#[derive(Subcommand)]
enum Command {
    /// Run the service.
    Serve(Box<ServeArgs>),
    /// Create the device CA (once). Prints its certificate for the border Nginx.
    InitCa {
        #[arg(long, env = "ENROLL_CA_DIR", default_value = "/device-ca")]
        ca_dir: PathBuf,
    },
    /// Print the device CA certificate (for the border Nginx).
    Ca,
    /// List enrollment requests.
    Requests,
    /// Approve the request whose code the device shows.
    Approve {
        code: String,
        /// Assign this ID instead of the requested one.
        #[arg(long = "as")]
        device_id: Option<String>,
        /// Re-enroll a device that already exists (its current login stops working).
        #[arg(long)]
        replace: bool,
    },
    /// Reject a request.
    Reject { code: String },
    /// List enrolled devices.
    Devices,
    /// Block a device's broker login (takes effect at once).
    Disable { device_id: String },
    /// Unblock a device's broker login.
    Enable { device_id: String },
}

#[derive(clap::Args)]
struct ServeArgs {
    /// Devices, through the border Nginx.
    #[arg(long, env = "ENROLL_PUBLIC_LISTEN", default_value = "0.0.0.0:8082")]
    public_listen: SocketAddr,
    /// Admin API; keep it on loopback.
    #[arg(long, env = "ENROLL_ADMIN_LISTEN", default_value = "127.0.0.1:8083")]
    admin_listen: SocketAddr,
    #[arg(long, env = "ENROLL_CA_DIR", default_value = "/device-ca")]
    ca_dir: PathBuf,
    /// Issue log (issued.jsonl).
    #[arg(long, env = "ENROLL_DATA_DIR", default_value = "/data")]
    data_dir: PathBuf,
    /// Internal broker listener.
    #[arg(long, env = "MQTT_URL", default_value = "mqtt://mosquitto:1883")]
    mqtt_url: String,
    #[arg(long, env = "MQTT_DYNSEC_ADMIN_USER", default_value = "dynsec-admin")]
    mqtt_admin_user: String,
    #[arg(long, env = "MQTT_DYNSEC_ADMIN_PASSWORD", hide_env_values = true)]
    mqtt_admin_password: String,
    /// Kept in the broker as user `ingest`, pinned to `--ingest-client-id`.
    #[arg(long, env = "INGEST_MQTT_PASSWORD", hide_env_values = true)]
    ingest_password: Option<String>,
    #[arg(long, env = "INGEST_MQTT_CLIENT_ID", default_value = "ingest")]
    ingest_client_id: String,
    /// Kept in the broker as the read-only user `pit-wall` (browsers).
    #[arg(long, env = "PIT_WALL_MQTT_PASSWORD", hide_env_values = true)]
    pit_wall_password: Option<String>,
    #[arg(long, env = "ENROLL_CERT_DAYS", default_value_t = 365)]
    cert_days: i64,
    /// How long a request waits for approval, and how long an answer stays collectable.
    #[arg(long, env = "ENROLL_REQUEST_TTL_S", default_value_t = 600)]
    request_ttl_s: i64,
    #[arg(long, env = "ENROLL_MAX_PENDING", default_value_t = 32)]
    max_pending: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Serve(args) => serve(*args).await,
        Command::InitCa { ca_dir } => {
            let pem = ca::init(&ca_dir)?;
            eprintln!(
                "Created the device CA in {}. Give this certificate to the border Nginx (ssl_client_certificate):",
                ca_dir.display()
            );
            print!("{pem}");
            Ok(())
        }
        cmd => admin(&cli.admin_url, cmd).await,
    }
}

async fn serve(args: ServeArgs) -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    if !args.admin_listen.ip().is_loopback() {
        bail!("--admin-listen must be a loopback address: the admin API has no authentication");
    }
    let ca = ca::DeviceCa::load(&args.ca_dir)?;
    std::fs::create_dir_all(&args.data_dir)
        .with_context(|| format!("creating {}", args.data_dir.display()))?;
    let dynsec = dynsec::Dynsec::connect(
        &args.mqtt_url,
        "enroll",
        &args.mqtt_admin_user,
        &args.mqtt_admin_password,
    )?;
    let users = server::InternalUsers {
        ingest_password: args.ingest_password.filter(|p| !p.is_empty()),
        ingest_client_id: args.ingest_client_id,
        pit_wall_password: args.pit_wall_password.filter(|p| !p.is_empty()),
    };
    {
        let d = dynsec.clone();
        tokio::spawn(async move { server::bootstrap_until_done(&d, &users).await });
    }
    let app = Arc::new(server::App {
        store: store::Store::new(args.request_ttl_s, args.max_pending),
        ca,
        dynsec,
        cert_days: args.cert_days,
        data_dir: args.data_dir,
        approving: tokio::sync::Mutex::new(()),
    });

    let public = TcpListener::bind(args.public_listen).await?;
    let admin = TcpListener::bind(args.admin_listen).await?;
    info!(public = %args.public_listen, admin = %args.admin_listen, "listening");
    let public = axum::serve(
        public,
        server::public_router(app.clone()).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal());
    let admin =
        axum::serve(admin, server::admin_router(app)).with_graceful_shutdown(shutdown_signal());
    tokio::try_join!(async { public.await.context("public API") }, async {
        admin.await.context("admin API")
    })?;
    Ok(())
}

async fn shutdown_signal() {
    use tokio::signal::unix::{SignalKind, signal};
    let mut term = signal(SignalKind::terminate()).expect("installing SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

// ---- admin CLI ----

async fn admin(base: &str, cmd: Command) -> Result<()> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    match cmd {
        Command::Ca => {
            let pem = http.get(format!("{base}/admin/ca")).send().await?;
            print!("{}", check(pem).await?.text().await?);
        }
        Command::Requests => {
            let list: Vec<serde_json::Value> =
                json(http.get(format!("{base}/admin/requests"))).await?;
            if list.is_empty() {
                println!("No enrollment requests.");
            }
            for r in list {
                let left = r["expires_at_s"].as_i64().unwrap_or(0) - store::now_s();
                println!(
                    "{:<10} {:<8} {:<7} {:<28} from {:<16} {}",
                    r["code"].as_str().unwrap_or(""),
                    r["state"].as_str().unwrap_or(""),
                    r["kind"].as_str().unwrap_or(""),
                    r["requested_id"].as_str().unwrap_or(""),
                    r["source"].as_str().unwrap_or(""),
                    format_args!("{}:{:02} left", left / 60, left % 60),
                );
            }
        }
        Command::Approve {
            code,
            device_id,
            replace,
        } => {
            let body = server::Approval { device_id, replace };
            let a: server::Approved = json(
                http.post(format!("{base}/admin/requests/{code}/approve"))
                    .json(&body),
            )
            .await?;
            println!(
                "Approved {} ({:?}), certificate {} valid until {}. The device connects within a few seconds.",
                a.device_id,
                a.kind,
                a.serial,
                date(a.not_after_s)
            );
        }
        Command::Reject { code } => {
            check(
                http.post(format!("{base}/admin/requests/{code}/reject"))
                    .send()
                    .await?,
            )
            .await?;
            println!("Rejected {code}.");
        }
        Command::Devices => {
            let list: Vec<server::Device> = json(http.get(format!("{base}/admin/devices"))).await?;
            if list.is_empty() {
                println!("No enrolled devices.");
            }
            for d in list {
                println!(
                    "{:<28} {:<7} client id {:<32} {}",
                    d.device_id,
                    format!("{:?}", d.kind).to_lowercase(),
                    d.client_id.unwrap_or_default(),
                    if d.disabled { "DISABLED" } else { "enabled" }
                );
            }
        }
        Command::Disable { device_id } => {
            check(
                http.post(format!("{base}/admin/devices/{device_id}/disable"))
                    .send()
                    .await?,
            )
            .await?;
            println!("Disabled {device_id}: its broker login is refused from now on.");
        }
        Command::Enable { device_id } => {
            check(
                http.post(format!("{base}/admin/devices/{device_id}/enable"))
                    .send()
                    .await?,
            )
            .await?;
            println!("Enabled {device_id}.");
        }
        Command::Serve(_) | Command::InitCa { .. } => unreachable!(),
    }
    Ok(())
}

async fn check(res: reqwest::Response) -> Result<reqwest::Response> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    bail!(
        "{}",
        body["error"]
            .as_str()
            .map_or_else(|| status.to_string(), str::to_owned)
    )
}

async fn json<T: DeserializeOwned>(req: reqwest::RequestBuilder) -> Result<T> {
    let res = req
        .send()
        .await
        .context("the enroll service is not reachable (is it running?)")?;
    Ok(check(res).await?.json().await?)
}

fn date(unix_s: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp(unix_s)
        .map(|t| t.date().to_string())
        .unwrap_or_else(|_| unix_s.to_string())
}
