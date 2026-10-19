use std::{env, fmt::Write as _, fs, path::PathBuf};

use prost::Message;
use serde::Deserialize;

#[derive(Deserialize)]
struct Catalog {
    signals: Vec<Signal>,
}

#[derive(Deserialize)]
struct Signal {
    id: u32,
    name: String,
}

// Compiles schema/proto with protox (pure Rust), so no protoc install is needed.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_dir = "../../schema/proto";
    let signals_yaml = "../../schema/signals.yaml";
    println!("cargo:rerun-if-changed={proto_dir}");
    println!("cargo:rerun-if-changed={signals_yaml}");
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);

    let fds = protox::compile([format!("{proto_dir}/telemetry.proto")], [proto_dir])?;
    // Self-describing logs (MCAP) embed the schema next to the data.
    fs::write(out_dir.join("telemetry.fds.bin"), fds.encode_to_vec())?;
    prost_build::Config::new().compile_fds(fds)?;

    // One constant per signal, so code that names a signal breaks at compile time
    // when the catalog renames or drops it.
    let catalog: Catalog = serde_norway::from_str(&fs::read_to_string(signals_yaml)?)?;
    let mut ids = String::new();
    for s in &catalog.signals {
        let name = s.name.to_uppercase().replace(['.', '-'], "_");
        writeln!(ids, "/// `{}`\npub const {name}: u32 = {};", s.name, s.id)?;
    }
    fs::write(out_dir.join("ids.rs"), ids)?;
    Ok(())
}
