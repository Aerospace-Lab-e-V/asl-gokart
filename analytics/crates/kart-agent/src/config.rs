//! Agent configuration, in layers (later wins):
//!
//! 1. built-in defaults ([`Config::default`])
//! 2. `$CONFIGURATION_DIRECTORY/agent.toml`: optional, written by an admin, never by us
//! 3. `$STATE_DIRECTORY/config.override.json`: what the headunit set through the API
//! 4. an extra TOML file given with `--config` (development)
//!
//! Layers are merged as JSON objects, so a layer only needs the keys it changes.
//! Unknown keys are ignored, which keeps an older agent working with a newer file.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub kart_id: String,
    pub live: Live,
    pub sero: Sero,
    pub log: Log,
    pub retention: Retention,
    pub vehicle: Vehicle,
    pub api: Api,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Live {
    /// Live uplink on/off. Local logging is always on.
    pub enabled: bool,
    /// `mqtt://host:port`; empty means no uplink.
    pub broker_url: String,
    pub batch_ms: u64,
    pub max_samples_per_batch: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Sero {
    /// Network interface of the car network; the agent waits until it has an IPv4 address.
    pub interface: String,
    pub client_id: u16,
    /// Unicast port; must differ from the headunit's (30491).
    pub port: u16,
    pub subscribe_ttl_s: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Log {
    /// A new MCAP segment is started at least this often.
    pub segment_minutes: u64,
    /// Close the current chunk and fdatasync this often; bounds data lost on power loss.
    pub sync_interval_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Retention {
    /// Delete the oldest finished segments while the log is larger than this...
    pub max_bytes: u64,
    /// ...or the file system has less free space than this.
    pub min_free_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Vehicle {
    pub wheel_circumference_m: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Api {
    /// Loopback only, unless the agent runs with `--api-allow-remote` (containers).
    pub listen: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            kart_id: "kart-01".into(),
            live: Live::default(),
            sero: Sero::default(),
            log: Log::default(),
            retention: Retention::default(),
            vehicle: Vehicle::default(),
            api: Api::default(),
        }
    }
}

impl Default for Live {
    fn default() -> Self {
        Self {
            enabled: true,
            broker_url: String::new(),
            batch_ms: 50,
            max_samples_per_batch: 400,
        }
    }
}

impl Default for Sero {
    fn default() -> Self {
        Self {
            interface: "eth0".into(),
            client_id: 0x0010,
            port: 30492,
            subscribe_ttl_s: 15,
        }
    }
}

impl Default for Log {
    fn default() -> Self {
        Self {
            segment_minutes: 30,
            sync_interval_ms: 1000,
        }
    }
}

impl Default for Retention {
    fn default() -> Self {
        Self {
            max_bytes: 4 << 30,
            min_free_bytes: 1 << 30,
        }
    }
}

impl Default for Vehicle {
    fn default() -> Self {
        Self {
            wheel_circumference_m: ecu_sero::WHEEL_CIRCUMFERENCE_M,
        }
    }
}

impl Default for Api {
    fn default() -> Self {
        Self {
            listen: "127.0.0.1:7411".into(),
        }
    }
}

pub const ADMIN_FILE: &str = "agent.toml";
pub const OVERRIDE_FILE: &str = "config.override.json";

/// Where the layers live.
#[derive(Debug, Clone)]
pub struct Sources {
    pub admin: PathBuf,
    pub overrides: PathBuf,
    pub dev: Option<PathBuf>,
}

impl Sources {
    pub fn new(config_dir: &Path, state_dir: &Path, dev: Option<PathBuf>) -> Self {
        Self {
            admin: config_dir.join(ADMIN_FILE),
            overrides: state_dir.join(OVERRIDE_FILE),
            dev,
        }
    }
}

/// The merged configuration plus the API-owned layer, as the API reports it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Loaded {
    pub effective: Config,
    pub overrides: Value,
}

pub fn load(sources: &Sources) -> Result<Loaded> {
    let mut merged = serde_json::to_value(Config::default())?;
    if let Some(admin) = read_toml(&sources.admin)? {
        merge(&mut merged, admin);
    }
    let overrides = read_json(&sources.overrides)?.unwrap_or_else(|| Value::Object(Map::new()));
    merge(&mut merged, overrides.clone());
    if let Some(dev) = &sources.dev {
        let dev = read_toml(dev)?.with_context(|| format!("{} not found", dev.display()))?;
        merge(&mut merged, dev);
    }
    let effective: Config = serde_json::from_value(merged).context("invalid configuration")?;
    effective.validate()?;
    Ok(Loaded {
        effective,
        overrides,
    })
}

/// Applies an RFC 7396 merge patch to the override layer and stores it, if the result
/// is a valid configuration. Returns the new configuration.
pub fn apply_patch(sources: &Sources, patch: Value) -> Result<Loaded> {
    if !patch.is_object() {
        bail!("the patch must be a JSON object");
    }
    if patch.get("api").is_some() {
        bail!("api settings can only be changed in {ADMIN_FILE}");
    }
    let mut overrides = read_json(&sources.overrides)?.unwrap_or_else(|| Value::Object(Map::new()));
    merge(&mut overrides, patch);
    let candidate = Sources {
        overrides: sources.overrides.with_extension("candidate.json"),
        ..sources.clone()
    };
    write_atomic(
        &candidate.overrides,
        &serde_json::to_vec_pretty(&overrides)?,
    )?;
    let loaded = load(&candidate);
    match loaded {
        Ok(loaded) => {
            fs::rename(&candidate.overrides, &sources.overrides)?;
            Ok(loaded)
        }
        Err(e) => {
            let _ = fs::remove_file(&candidate.overrides);
            Err(e)
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<()> {
        let topic_safe = |s: &str| {
            !s.is_empty()
                && s.len() <= 64
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        };
        if !topic_safe(&self.kart_id) {
            bail!("kart_id must be 1–64 characters of [A-Za-z0-9_-]");
        }
        let url = &self.live.broker_url;
        if !url.is_empty() && !url.starts_with("mqtt://") {
            bail!("live.broker_url must start with mqtt:// (or be empty)");
        }
        if !(10..=1000).contains(&self.live.batch_ms) {
            bail!("live.batch_ms must be between 10 and 1000");
        }
        if !(1..=10_000).contains(&self.live.max_samples_per_batch) {
            bail!("live.max_samples_per_batch must be between 1 and 10000");
        }
        if self.sero.interface.is_empty() {
            bail!("sero.interface must not be empty");
        }
        if self.sero.port == 0 || self.sero.port == 30491 {
            bail!("sero.port must not be 0 or the headunit's 30491");
        }
        if self.sero.subscribe_ttl_s < 2 {
            bail!("sero.subscribe_ttl_s must be at least 2");
        }
        if self.log.segment_minutes == 0 || self.log.sync_interval_ms < 100 {
            bail!("log.segment_minutes must be > 0 and log.sync_interval_ms ≥ 100");
        }
        if !(self.vehicle.wheel_circumference_m > 0.1 && self.vehicle.wheel_circumference_m < 10.0)
        {
            bail!("vehicle.wheel_circumference_m must be between 0.1 and 10");
        }
        Ok(())
    }

    /// Settings that a running agent can switch without restarting.
    pub fn differs_only_in_live_toggle(&self, other: &Config) -> bool {
        let mut a = self.clone();
        a.live.enabled = other.live.enabled;
        &a == other
    }
}

/// RFC 7396: objects merge recursively, `null` deletes, anything else replaces.
pub fn merge(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(t), Value::Object(p)) => {
            for (k, v) in p {
                if v.is_null() {
                    t.remove(&k);
                } else {
                    merge(t.entry(k).or_insert(Value::Null), v);
                }
            }
        }
        (t, p) => *t = p,
    }
}

fn read_toml(path: &Path) -> Result<Option<Value>> {
    let Some(text) = read_optional(path)? else {
        return Ok(None);
    };
    let table: toml::Table =
        toml::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
    Ok(Some(serde_json::to_value(table)?))
}

fn read_json(path: &Path) -> Result<Option<Value>> {
    let Some(text) = read_optional(path)? else {
        return Ok(None);
    };
    Ok(Some(
        serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))?,
    ))
}

fn read_optional(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
    }
}

/// Write to a temporary file, fsync, rename: readers never see a half-written file.
pub fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut f = fs::File::create(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn sources(dir: &Path) -> Sources {
        Sources::new(&dir.join("etc"), &dir.join("state"), None)
    }

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kart-agent-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("etc")).unwrap();
        fs::create_dir_all(dir.join("state")).unwrap();
        dir
    }

    #[test]
    fn defaults_are_valid() {
        Config::default().validate().unwrap();
        let dir = tempdir("defaults");
        assert_eq!(load(&sources(&dir)).unwrap().effective, Config::default());
    }

    #[test]
    fn layers_merge_in_order() {
        let dir = tempdir("layers");
        let s = sources(&dir);
        fs::write(
            &s.admin,
            "kart_id = \"kart-07\"\n[sero]\ninterface = \"end0\"\nport = 31000\nunknown = 1\n",
        )
        .unwrap();
        fs::write(&s.overrides, r#"{"sero": {"port": 32000}}"#).unwrap();
        let c = load(&s).unwrap().effective;
        assert_eq!(c.kart_id, "kart-07");
        assert_eq!(c.sero.interface, "end0");
        assert_eq!(c.sero.port, 32000);
        assert_eq!(c.sero.client_id, 0x0010);
    }

    #[test]
    fn patch_is_validated_and_persisted() {
        let dir = tempdir("patch");
        let s = sources(&dir);
        let loaded = apply_patch(&s, json!({"live": {"broker_url": "mqtt://pit:1883"}})).unwrap();
        assert_eq!(loaded.effective.live.broker_url, "mqtt://pit:1883");
        assert_eq!(
            load(&s).unwrap().overrides,
            json!({"live": {"broker_url": "mqtt://pit:1883"}})
        );

        assert!(apply_patch(&s, json!({"kart_id": "kart/01"})).is_err());
        assert!(apply_patch(&s, json!({"api": {"listen": "0.0.0.0:1"}})).is_err());
        // A rejected patch leaves the stored layer alone.
        assert_eq!(load(&s).unwrap().effective.kart_id, "kart-01");

        // null removes an override again.
        let loaded = apply_patch(&s, json!({"live": {"broker_url": null}})).unwrap();
        assert_eq!(loaded.effective.live.broker_url, "");
    }

    #[test]
    fn live_toggle_is_the_only_hot_setting() {
        let a = Config::default();
        let mut b = a.clone();
        b.live.enabled = false;
        assert!(a.differs_only_in_live_toggle(&b));
        b.live.batch_ms = 100;
        assert!(!a.differs_only_in_live_toggle(&b));
    }
}
