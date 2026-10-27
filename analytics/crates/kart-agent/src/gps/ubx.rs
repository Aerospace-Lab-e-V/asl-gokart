//! The few UBX messages the agent sends to the u-blox 6 (protocol spec GPS.G6-SW-10018).
//!
//! Everything goes to the receiver's RAM only (no CFG-CFG save), so the module is
//! configured again on every open and a replaced module behaves the same.

pub const SYNC: [u8; 2] = [0xB5, 0x62];

pub const CLASS_ACK: u8 = 0x05;
pub const ACK_NAK: u8 = 0x00;
pub const ACK_ACK: u8 = 0x01;

const CLASS_CFG: u8 = 0x06;
const CFG_MSG: u8 = 0x01;
const CFG_RATE: u8 = 0x08;
const CFG_NAV5: u8 = 0x24;

const CLASS_NMEA: u8 = 0xF0;
const NMEA_GLL: u8 = 0x01;
const NMEA_GSV: u8 = 0x03;
const NMEA_VTG: u8 = 0x05;

/// UBX-CFG-NAV5 dynamic platform model "automotive".
const DYN_MODEL_AUTOMOTIVE: u8 = 4;

/// 8-bit Fletcher checksum over class, id, length and payload.
pub fn checksum(bytes: &[u8]) -> [u8; 2] {
    let (mut a, mut b) = (0u8, 0u8);
    for &x in bytes {
        a = a.wrapping_add(x);
        b = b.wrapping_add(a);
    }
    [a, b]
}

pub fn frame(class: u8, id: u8, payload: &[u8]) -> Vec<u8> {
    let len = u16::try_from(payload.len()).expect("UBX payload too long");
    let mut out = Vec::with_capacity(payload.len() + 8);
    out.extend_from_slice(&SYNC);
    out.extend_from_slice(&[class, id]);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(payload);
    let ck = checksum(&out[2..]);
    out.extend_from_slice(&ck);
    out
}

/// A configuration message and the (class, id) its ACK refers to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Command {
    pub name: &'static str,
    pub class: u8,
    pub id: u8,
    pub bytes: Vec<u8>,
}

impl Command {
    fn new(name: &'static str, class: u8, id: u8, payload: &[u8]) -> Self {
        Self {
            name,
            class,
            id,
            bytes: frame(class, id, payload),
        }
    }
}

/// Measurement rate, automotive model, and only RMC + GGA + GSA left on (GSA ends an
/// epoch, see [`super::epoch`]).
pub fn configuration(rate_hz: u8) -> Vec<Command> {
    let meas_ms = 1000 / u16::from(rate_hz.max(1));
    let mut rate = Vec::with_capacity(6);
    rate.extend_from_slice(&meas_ms.to_le_bytes());
    rate.extend_from_slice(&1u16.to_le_bytes()); // navRate: one solution per measurement
    rate.extend_from_slice(&1u16.to_le_bytes()); // timeRef: GPS time

    let mut nav5 = [0u8; 36];
    nav5[0..2].copy_from_slice(&1u16.to_le_bytes()); // mask: apply dynModel only
    nav5[2] = DYN_MODEL_AUTOMOTIVE;

    vec![
        Command::new("rate", CLASS_CFG, CFG_RATE, &rate),
        Command::new("nav5", CLASS_CFG, CFG_NAV5, &nav5),
        Command::new("gll_off", CLASS_CFG, CFG_MSG, &[CLASS_NMEA, NMEA_GLL, 0]),
        Command::new("gsv_off", CLASS_CFG, CFG_MSG, &[CLASS_NMEA, NMEA_GSV, 0]),
        Command::new("vtg_off", CLASS_CFG, CFG_MSG, &[CLASS_NMEA, NMEA_VTG, 0]),
    ]
}

/// An ACK-ACK or ACK-NAK: `Some((class, id, acked))`.
pub fn parse_ack(class: u8, id: u8, payload: &[u8]) -> Option<(u8, u8, bool)> {
    if class != CLASS_ACK || payload.len() != 2 {
        return None;
    }
    match id {
        ACK_ACK => Some((payload[0], payload[1], true)),
        ACK_NAK => Some((payload[0], payload[1], false)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_5hz_matches_u_center() {
        let rate = &configuration(5)[0];
        assert_eq!(
            rate.bytes,
            [
                0xB5, 0x62, 0x06, 0x08, 0x06, 0x00, 0xC8, 0x00, 0x01, 0x00, 0x01, 0x00, 0xDE, 0x6A
            ]
        );
    }

    #[test]
    fn disable_gll_matches_u_center() {
        let gll = configuration(5)
            .into_iter()
            .find(|c| c.name == "gll_off")
            .unwrap();
        assert_eq!(
            gll.bytes,
            [
                0xB5, 0x62, 0x06, 0x01, 0x03, 0x00, 0xF0, 0x01, 0x00, 0xFB, 0x11
            ]
        );
    }

    #[test]
    fn nav5_sets_automotive_only() {
        let nav5 = &configuration(5)[1];
        assert_eq!(nav5.bytes.len(), 36 + 8);
        assert_eq!(&nav5.bytes[2..8], &[0x06, 0x24, 36, 0, 0x01, 0x00]);
        assert_eq!(nav5.bytes[8], DYN_MODEL_AUTOMOTIVE);
        assert!(nav5.bytes[9..42].iter().all(|&b| b == 0));
    }

    #[test]
    fn acks() {
        assert_eq!(
            parse_ack(0x05, 0x01, &[0x06, 0x08]),
            Some((0x06, 0x08, true))
        );
        assert_eq!(
            parse_ack(0x05, 0x00, &[0x06, 0x24]),
            Some((0x06, 0x24, false))
        );
        assert_eq!(parse_ack(0x01, 0x01, &[0x06, 0x08]), None);
    }
}
