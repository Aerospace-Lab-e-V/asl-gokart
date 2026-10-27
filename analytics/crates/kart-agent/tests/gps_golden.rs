//! Byte streams captured from a Navilock NL-602U (u-blox 6, firmware 7.03), fed through
//! the framer and epoch assembler exactly as the provider does.

use kart_agent::gps::{
    epoch::{Assembler, Epoch, fix},
    framer::{Frame, Framer},
    ubx,
};
use telemetry_schema::ids;

fn run(bytes: &[u8], chunk: usize) -> (Vec<Epoch>, Assembler, u64) {
    let mut framer = Framer::default();
    let mut assembler = Assembler::default();
    let mut frames = Vec::new();
    let mut epochs = Vec::new();
    for (i, c) in bytes.chunks(chunk).enumerate() {
        framer.push(c, &mut frames);
        for f in frames.drain(..) {
            if let Frame::Nmea(line) = f
                && let Some(e) = assembler.push(&line, i as i64)
            {
                epochs.push(e);
            }
        }
    }
    (epochs, assembler, framer.errors)
}

/// Cold start indoors at the factory default 1 Hz: RMC, VTG, GGA, GSA, GSV, GLL and
/// the start-up GPTXT lines.
#[test]
fn no_fix_at_factory_settings() {
    let bytes = include_bytes!("fixtures/nmea/no-fix.nmea");
    let (epochs, assembler, framer_errors) = run(bytes, 64);
    assert_eq!(framer_errors, 0);
    assert_eq!(assembler.errors, 0);
    assert_eq!(epochs.len(), 6, "one per GSA");
    for e in &epochs {
        assert_eq!(e.fix, fix::NONE);
        assert_eq!(e.satellites, 0);
        let ids: Vec<u32> = e.samples().iter().map(|s| s.signal_id).collect();
        assert_eq!(ids, [ids::GPS_FIX, ids::GPS_SATELLITES]);
    }
    assert_eq!(
        assembler.firmware.as_deref(),
        Some("UBX-G60xx 00040007, EXT CORE 7.03 (45970) Mar 17 2011 16:26:24")
    );
}

/// After the agent configured the receiver: 5 Hz, only RMC, GGA and GSA. Recorded
/// outdoors right after a cold start, so still without a fix (60 s).
#[test]
fn no_fix_configured_5hz() {
    let bytes = include_bytes!("fixtures/nmea/no-fix-5hz.nmea");
    let (epochs, assembler, framer_errors) = run(bytes, 64);
    assert_eq!(framer_errors, 0);
    assert_eq!(assembler.errors, 0);
    assert_eq!(epochs.len(), 300, "60 s at 5 Hz, one epoch per GSA");
    assert!(epochs.iter().all(|e| e.fix == fix::NONE && e.lat.is_none()));
}

/// ACKs to our configuration arrive between sentences and must not disturb them.
#[test]
fn acks_interleaved_with_sentences() {
    let mut bytes = Vec::new();
    for (i, line) in include_bytes!("fixtures/nmea/no-fix.nmea")
        .split_inclusive(|&b| b == b'\n')
        .enumerate()
    {
        bytes.extend_from_slice(line);
        if i % 7 == 0 {
            bytes.extend_from_slice(&ubx::frame(0x05, 0x01, &[0x06, 0x08]));
        }
    }
    let (epochs, assembler, framer_errors) = run(&bytes, 17);
    assert_eq!(framer_errors, 0);
    assert_eq!(assembler.errors, 0);
    assert_eq!(epochs.len(), 6);
}
