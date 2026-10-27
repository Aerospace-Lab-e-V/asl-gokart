//! NMEA sentences → one [`Epoch`] per navigation solution → catalog samples.
//!
//! The u-blox 6 sends each solution as RMC, (VTG), GGA, GSA, (GSV, GLL). An epoch
//! collects RMC and GGA of one time of fix and ends with GSA, or when a sentence with
//! a different time of fix starts the next one. All samples of an epoch carry the
//! receive time of its first sentence: the clock is the Pi's (like Sero samples), and
//! lat/lon must share a timestamp to be joined downstream.

use nmea::{
    ParseResult,
    sentences::{FixType, GgaData, GsaData, RmcData, gsa::GsaMode2, rmc::RmcStatusOfFix},
};
use telemetry_schema::{ids, v1::Sample};

const KNOTS_TO_KMH: f64 = 1.852;
/// Course over ground is noise below this.
pub const MIN_HEADING_SPEED_KMH: f64 = 3.0;

/// `gps.fix` values.
pub mod fix {
    pub const NONE: u8 = 0;
    pub const FIX_2D: u8 = 2;
    pub const FIX_3D: u8 = 3;
    pub const FIX_3D_DGPS: u8 = 4;
}

#[derive(Debug, Clone, PartialEq)]
pub struct Epoch {
    pub t_us: i64,
    pub fix: u8,
    pub satellites: u32,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub altitude_m: Option<f64>,
    pub speed_kmh: Option<f64>,
    pub heading_deg: Option<f64>,
    pub hdop: Option<f64>,
}

impl Epoch {
    fn new(t_us: i64, rmc: Option<&RmcData>, gga: Option<&GgaData>, gsa: Option<&GsaData>) -> Self {
        let dimensions = match gsa.map(|g| g.mode2) {
            Some(GsaMode2::NoFix) => fix::NONE,
            Some(GsaMode2::Fix2D) => fix::FIX_2D,
            Some(GsaMode2::Fix3D) => fix::FIX_3D,
            // GSA turned off or lost: trust GGA alone.
            None => match gga.and_then(|g| g.fix_type) {
                Some(t) if t.is_valid() => fix::FIX_3D,
                _ => fix::NONE,
            },
        };
        let gga_valid = gga.is_none_or(|g| g.fix_type.is_some_and(FixType::is_valid));
        let rmc_valid = rmc.is_none_or(|r| r.status_of_fix != RmcStatusOfFix::Invalid);
        let mut fix = if gga_valid && rmc_valid {
            dimensions
        } else {
            fix::NONE
        };
        if fix == fix::FIX_3D && gga.and_then(|g| g.fix_type) == Some(FixType::DGps) {
            fix = fix::FIX_3D_DGPS;
        }
        let satellites = gga
            .and_then(|g| g.fix_satellites)
            .or_else(|| gsa.map(|g| g.fix_sats_prn.len() as u32))
            .unwrap_or(0);

        let mut epoch = Self {
            t_us,
            fix,
            satellites,
            lat: None,
            lon: None,
            altitude_m: None,
            speed_kmh: None,
            heading_deg: None,
            hdop: None,
        };
        if fix == fix::NONE {
            return epoch;
        }
        let position = gga
            .and_then(|g| g.latitude.zip(g.longitude))
            .or_else(|| rmc.and_then(|r| r.lat.zip(r.lon)));
        epoch.lat = position.map(|p| p.0);
        epoch.lon = position.map(|p| p.1);
        epoch.hdop = gga
            .and_then(|g| g.hdop)
            .or_else(|| gsa.and_then(|g| g.hdop))
            .map(f64::from);
        if fix >= fix::FIX_3D {
            epoch.altitude_m = gga.and_then(|g| g.altitude).map(f64::from);
        }
        if let Some(rmc) = rmc {
            epoch.speed_kmh = rmc.speed_over_ground.map(|kn| f64::from(kn) * KNOTS_TO_KMH);
            if epoch.speed_kmh.is_some_and(|v| v >= MIN_HEADING_SPEED_KMH) {
                epoch.heading_deg = rmc.true_course.map(|c| f64::from(c).rem_euclid(360.0));
            }
        }
        epoch
    }

    /// `gps.fix` and `gps.satellites` always; the rest only with a fix.
    pub fn samples(&self) -> Vec<Sample> {
        let mut out = Vec::with_capacity(8);
        let mut put = |signal_id, value: f64| {
            out.push(Sample {
                signal_id,
                t_us: self.t_us,
                value,
            })
        };
        put(ids::GPS_FIX, f64::from(self.fix));
        put(ids::GPS_SATELLITES, f64::from(self.satellites));
        let optional = [
            (ids::GPS_LAT, self.lat),
            (ids::GPS_LON, self.lon),
            (ids::GPS_SPEED, self.speed_kmh),
            (ids::GPS_HEADING, self.heading_deg),
            (ids::GPS_ALTITUDE, self.altitude_m),
            (ids::GPS_HDOP, self.hdop),
        ];
        for (id, value) in optional {
            if let Some(v) = value {
                put(id, v);
            }
        }
        out
    }
}

#[derive(Default)]
struct Pending {
    time: Option<chrono::NaiveTime>,
    rx_us: i64,
    rmc: Option<RmcData>,
    gga: Option<GgaData>,
}

#[derive(Default)]
pub struct Assembler {
    pending: Option<Pending>,
    /// Well-formed sentences, including types we ignore.
    pub sentences: u64,
    /// Checksum mismatches and malformed sentences.
    pub errors: u64,
    /// Hardware and firmware from the receiver's start-up `GPTXT` lines.
    pub firmware: Option<String>,
}

impl Assembler {
    /// Drops a half-assembled epoch, e.g. after reopening the device.
    pub fn reset(&mut self) {
        self.pending = None;
    }

    /// `rx_us`: when the sentence was read, µs since the Unix epoch.
    pub fn push(&mut self, sentence: &str, rx_us: i64) -> Option<Epoch> {
        let parsed = match nmea::parse_str(sentence) {
            Ok(p) => p,
            Err(nmea::Error::DisabledSentence | nmea::Error::Unsupported(_)) => {
                self.sentences += 1;
                return None;
            }
            Err(_) => {
                self.errors += 1;
                return None;
            }
        };
        self.sentences += 1;
        match parsed {
            ParseResult::RMC(rmc) => {
                let (done, pending) = self.pending_for(rmc.fix_time, rx_us);
                pending.rmc = Some(rmc);
                done
            }
            ParseResult::GGA(gga) => {
                let (done, pending) = self.pending_for(gga.fix_time, rx_us);
                pending.gga = Some(gga);
                done
            }
            ParseResult::GSA(gsa) => self
                .pending
                .take()
                .map(|p| Epoch::new(p.rx_us, p.rmc.as_ref(), p.gga.as_ref(), Some(&gsa))),
            ParseResult::TXT(txt) => {
                self.note_firmware(txt.text.as_str());
                None
            }
            _ => None,
        }
    }

    /// The epoch for `time`, finishing a pending one of a different time first.
    fn pending_for(
        &mut self,
        time: Option<chrono::NaiveTime>,
        rx_us: i64,
    ) -> (Option<Epoch>, &mut Pending) {
        let mut done = None;
        if self.pending.as_ref().is_some_and(|p| p.time != time) {
            let p = self.pending.take().expect("checked above");
            done = Some(Epoch::new(p.rx_us, p.rmc.as_ref(), p.gga.as_ref(), None));
        }
        let pending = self.pending.get_or_insert_with(|| Pending {
            time,
            rx_us,
            ..Default::default()
        });
        (done, pending)
    }

    fn note_firmware(&mut self, text: &str) {
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if let Some(hw) = text.strip_prefix("HW ") {
            self.firmware = Some(hw.to_owned());
        } else if text.contains("CORE")
            && let Some(hw) = &self.firmware
            && !hw.contains("CORE")
        {
            self.firmware = Some(format!("{hw}, {text}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Adds the `*hh` checksum.
    fn line(body: &str) -> String {
        let ck = body.bytes().fold(0u8, |a, b| a ^ b);
        format!("${body}*{ck:02X}")
    }

    fn feed(a: &mut Assembler, bodies: &[&str], rx_us: i64) -> Vec<Epoch> {
        bodies
            .iter()
            .filter_map(|b| a.push(&line(b), rx_us))
            .collect()
    }

    #[test]
    fn checksum_helper_matches_the_receiver() {
        assert_eq!(line("GPGSV,1,1,00"), "$GPGSV,1,1,00*79");
    }

    #[test]
    fn fix_3d_epoch() {
        let mut a = Assembler::default();
        let epochs = feed(
            &mut a,
            &[
                "GPRMC,123519.20,A,4807.0380,N,01131.0000,E,21.6,84.4,271026,,,A",
                "GPGGA,123519.20,4807.0380,N,01131.0000,E,1,08,0.9,545.4,M,46.9,M,,",
                "GPGSA,A,3,04,05,09,12,24,25,29,31,,,,,1.8,0.9,1.5",
            ],
            1_000,
        );
        assert_eq!(epochs.len(), 1);
        let e = &epochs[0];
        assert_eq!(e.fix, fix::FIX_3D);
        assert_eq!(e.satellites, 8);
        assert!((e.lat.unwrap() - 48.1173).abs() < 1e-6);
        assert!((e.lon.unwrap() - 11.516_666_7).abs() < 1e-6);
        assert!((e.speed_kmh.unwrap() - 21.6 * 1.852).abs() < 1e-3);
        assert!((e.heading_deg.unwrap() - 84.4).abs() < 1e-3);
        assert!((e.altitude_m.unwrap() - 545.4).abs() < 1e-3);
        assert!((e.hdop.unwrap() - 0.9).abs() < 1e-6);

        let samples = e.samples();
        assert_eq!(samples.len(), 8);
        assert!(samples.iter().all(|s| s.t_us == 1_000));
    }

    #[test]
    fn standing_still_has_no_heading() {
        let mut a = Assembler::default();
        let e = &feed(
            &mut a,
            &[
                "GPRMC,123519.20,A,4807.0380,N,01131.0000,E,0.8,213.0,271026,,,A",
                "GPGGA,123519.20,4807.0380,N,01131.0000,E,1,08,0.9,545.4,M,46.9,M,,",
                "GPGSA,A,3,04,05,09,12,24,25,29,31,,,,,1.8,0.9,1.5",
            ],
            0,
        )[0];
        assert!(e.speed_kmh.unwrap() < MIN_HEADING_SPEED_KMH);
        assert_eq!(e.heading_deg, None);
        assert!(e.samples().iter().all(|s| s.signal_id != ids::GPS_HEADING));
    }

    #[test]
    fn fix_2d_has_no_altitude() {
        let mut a = Assembler::default();
        let e = &feed(
            &mut a,
            &[
                "GPGGA,123519.20,4807.0380,N,01131.0000,E,1,03,2.5,545.4,M,46.9,M,,",
                "GPGSA,A,2,04,05,09,,,,,,,,,,2.7,2.5,1.0",
            ],
            0,
        )[0];
        assert_eq!(e.fix, fix::FIX_2D);
        assert!(e.lat.is_some());
        assert_eq!(e.altitude_m, None);
    }

    #[test]
    fn sbas_fix() {
        let mut a = Assembler::default();
        let e = &feed(
            &mut a,
            &[
                "GPGGA,123519.20,4807.0380,N,01131.0000,E,2,09,0.8,545.4,M,46.9,M,,",
                "GPGSA,A,3,04,05,09,12,24,25,29,31,33,,,,1.4,0.8,1.1",
            ],
            0,
        )[0];
        assert_eq!(e.fix, fix::FIX_3D_DGPS);
    }

    #[test]
    fn epoch_without_gsa_ends_at_the_next_time_of_fix() {
        let mut a = Assembler::default();
        let epochs = feed(
            &mut a,
            &[
                "GPRMC,123519.00,A,4807.0380,N,01131.0000,E,21.6,84.4,271026,,,A",
                "GPGGA,123519.00,4807.0380,N,01131.0000,E,1,08,0.9,545.4,M,46.9,M,,",
                "GPRMC,123519.20,A,4807.0390,N,01131.0010,E,21.6,84.4,271026,,,A",
            ],
            0,
        );
        assert_eq!(epochs.len(), 1);
        assert_eq!(epochs[0].fix, fix::FIX_3D);
        assert!((epochs[0].lat.unwrap() - 48.1173).abs() < 1e-6);
    }

    #[test]
    fn bad_checksum_is_counted() {
        let mut a = Assembler::default();
        assert_eq!(a.push("$GPGSV,1,1,00*78", 0), None);
        assert_eq!(a.errors, 1);
    }
}
