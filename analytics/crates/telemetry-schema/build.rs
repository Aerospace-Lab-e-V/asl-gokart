// Compiles schema/proto with protox (pure Rust), so no protoc install is needed.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_dir = "../../schema/proto";
    println!("cargo:rerun-if-changed={proto_dir}");
    println!("cargo:rerun-if-changed=../../schema/signals.yaml");

    let fds = protox::compile([format!("{proto_dir}/telemetry.proto")], [proto_dir])?;
    prost_build::Config::new().compile_fds(fds)?;
    Ok(())
}
