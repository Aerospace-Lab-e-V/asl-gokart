// sqlx::migrate! embeds db/migrations at compile time, but Cargo doesn't notice
// new files there on its own. Rebuild whenever the folder changes.
fn main() {
    println!("cargo:rerun-if-changed=../../db/migrations");
}
