//! Wire format of the device enrollment service (`crates/enroll`, ADR-0004), shared with
//! kart-agent. The speedcamera keeps its own copy (`headless-rust/src/plugins/kartlink`).
//!
//! Public endpoints (behind the border Nginx, under `/enroll/`):
//!
//! - `POST /enroll/v1/requests` with an [`EnrollRequest`] → `201` [`EnrollTicket`]
//! - `GET /enroll/v1/requests/{request_id}` → [`EnrollState`]; `404` when the request is
//!   unknown or expired
//!
//! Errors are `{"error": "..."}` with a 4xx/5xx status.

use serde::{Deserialize, Serialize};

pub const REQUESTS_PATH: &str = "/enroll/v1/requests";

/// Timing devices' broker users and client IDs: `speedcamera-<device_id>`.
pub const TIMING_PREFIX: &str = "speedcamera-";

/// Broker users that no device may be enrolled as.
pub const RESERVED_USERS: &[&str] = &[
    "ingest",
    "pit-wall",
    "command-api",
    "enroll",
    "dynsec-admin",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceKind {
    /// kart-agent on a kart's Pi.
    Kart,
    /// A trackside timing device (the speedcamera's light barrier).
    Timing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollRequest {
    pub kind: DeviceKind,
    /// The ID the device asks for: its kart ID, or `speedcamera-<device_id>`. The admin can
    /// assign another one when approving.
    pub requested_id: String,
    /// PKCS#10 certificate signing request (PEM). The subject is ignored: the certificate's
    /// common name is the approved ID.
    pub csr: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollTicket {
    /// Secret: whoever knows it can collect the credentials once the request is approved.
    pub request_id: String,
    /// Shown on the device; the admin approves the request by this code.
    pub code: String,
    /// Unix seconds; an unapproved request is forgotten after that.
    pub expires_at_s: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum EnrollState {
    Pending { code: String, expires_at_s: i64 },
    Approved(Credentials),
    Rejected,
}

/// What an approved device receives. The private key never left the device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Credentials {
    /// The approved ID: the kart ID, or `speedcamera-<device_id>`.
    pub device_id: String,
    /// Client certificate (PEM) for the border Nginx.
    pub certificate: String,
    /// The device CA's certificate (PEM).
    pub ca_certificate: String,
    /// Unix seconds.
    pub not_after_s: i64,
    pub mqtt_username: String,
    pub mqtt_password: String,
    /// The broker only accepts this client ID for the user.
    pub mqtt_client_id: String,
}

/// 1–64 characters of `[A-Za-z0-9_-]`: safe as an MQTT topic level and a user name.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Checks an ID for a device kind: karts must not look like timing devices or internal
/// users, timing devices must start with [`TIMING_PREFIX`].
pub fn validate_device_id(kind: DeviceKind, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("{id:?}: IDs are 1–64 characters of [A-Za-z0-9_-]"));
    }
    if RESERVED_USERS.contains(&id) {
        return Err(format!("{id:?} is reserved for an internal service"));
    }
    match kind {
        DeviceKind::Kart if id.starts_with(TIMING_PREFIX) => Err(format!(
            "kart IDs must not start with {TIMING_PREFIX:?} (reserved for timing devices)"
        )),
        DeviceKind::Timing if !id.starts_with(TIMING_PREFIX) || id.len() == TIMING_PREFIX.len() => {
            Err(format!(
                "timing device IDs look like {TIMING_PREFIX}<device_id>"
            ))
        }
        _ => Ok(()),
    }
}

/// The client ID a device must connect with.
pub fn client_id(kind: DeviceKind, device_id: &str) -> String {
    match kind {
        DeviceKind::Kart => format!("kart-agent-{device_id}"),
        DeviceKind::Timing => device_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_by_kind() {
        assert!(validate_device_id(DeviceKind::Kart, "kart-01").is_ok());
        assert!(validate_device_id(DeviceKind::Kart, "speedcamera-1").is_err());
        assert!(validate_device_id(DeviceKind::Kart, "ingest").is_err());
        assert!(validate_device_id(DeviceKind::Kart, "kart/01").is_err());
        assert!(validate_device_id(DeviceKind::Kart, "").is_err());
        assert!(validate_device_id(DeviceKind::Timing, "speedcamera-lab").is_ok());
        assert!(validate_device_id(DeviceKind::Timing, "speedcamera-").is_err());
        assert!(validate_device_id(DeviceKind::Timing, "kart-01").is_err());
    }

    #[test]
    fn client_ids() {
        assert_eq!(client_id(DeviceKind::Kart, "kart-01"), "kart-agent-kart-01");
        assert_eq!(
            client_id(DeviceKind::Timing, "speedcamera-lab"),
            "speedcamera-lab"
        );
    }

    #[test]
    fn state_json() {
        let s = EnrollState::Pending {
            code: "ABCD-EFGH".into(),
            expires_at_s: 1,
        };
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"state":"pending","code":"ABCD-EFGH","expires_at_s":1}"#
        );
    }
}
