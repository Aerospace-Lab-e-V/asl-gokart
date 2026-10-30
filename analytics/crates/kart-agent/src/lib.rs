//! kart-agent: the Pi's vehicle-data gateway. It subscribes to the zone controllers'
//! Sero events and reads the USB GPS, writes everything to a local MCAP log (the source
//! of truth), publishes live batches over MQTT, and is configured and monitored by the
//! headunit through a loopback HTTP API, which also streams the live samples to it. Runs
//! as the systemd service `kart-agent`, shipped in the headunit package. See
//! `docs/adr/0001-kart-agent-integration.md` and `docs/adr/0002-kart-agent-as-headunit-data-source.md`.

pub mod agent;
pub mod api;
pub mod clock;
pub mod config;
pub mod gps;
pub mod log;
pub mod pipeline;
pub mod sero;
pub mod session;
pub mod status;
pub mod stream;
pub mod systemd;
