//! A deliberately simple kart model: plausible, correlated signals, not accurate physics.
//!
//! The kart drives counter-clockwise laps on a stadium-shaped track. A driver model
//! follows a target speed (limited by drive mode and curve grip, braking before curves).
//! Throttle drives acceleration, which gives motor power, pack current, SoC drain and
//! temperatures via first-order lags. The controller- and lights-level signals (raw
//! pedal readings, switches, relays, lamps) are derived from the same state.

use std::f64::consts::PI;

use clap::ValueEnum;

const MASS_KG: f64 = 150.0;
const CDA_M2: f64 = 0.6;
const AIR_DENSITY: f64 = 1.2;
const ROLLING_RESISTANCE: f64 = 0.015;
const G: f64 = 9.81;
/// Direct drive: motor rpm is wheel rpm, as the headunit assumes (`motorSlice.ts`).
const WHEEL_CIRCUMFERENCE_M: f64 = 1.415;
const TRACK_WIDTH_M: f64 = 1.0;
const DRIVETRAIN_EFFICIENCY: f64 = 0.85;
const AUX_POWER_W: f64 = 150.0;
const MAX_ELECTRIC_POWER_W: f64 = 10_000.0;
const MAX_REGEN_POWER_W: f64 = 3_000.0;
const REGEN_SHARE: f64 = 0.4;
const BRAKE_DECEL: f64 = 5.0;
const LATERAL_GRIP: f64 = 5.0;
const PACK_CAPACITY_J: f64 = 2.5 * 3.6e6; // 2.5 kWh
const PACK_INTERNAL_RESISTANCE: f64 = 0.04;
const AMBIENT_C: f64 = 20.0;
const EARTH_M_PER_DEG: f64 = 111_320.0;
/// Pack temperature sensors (DS18B20) and how much warmer each runs than the pack average.
const TEMP_SENSOR_OFFSETS_C: [f64; 10] = [0.0, 0.4, 0.8, 1.2, 0.2, 0.6, 1.0, 1.4, 0.3, 0.7];
/// The driver indicates this far before each curve (both curves are left turns).
const INDICATE_BEFORE_CURVE_M: f64 = 40.0;
const BLINK_PERIOD_S: f64 = 0.7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum DriveMode {
    Eco = 0,
    Comfort = 1,
    Sport = 2,
    Ludicrous = 3,
}

impl DriveMode {
    /// (max acceleration m/s², top speed m/s)
    fn limits(self) -> (f64, f64) {
        match self {
            DriveMode::Eco => (2.0, 35.0 / 3.6),
            DriveMode::Comfort => (3.0, 45.0 / 3.6),
            DriveMode::Sport => (4.0, 55.0 / 3.6),
            DriveMode::Ludicrous => (4.5, 65.0 / 3.6),
        }
    }
}

/// Stadium-shaped track: two straights joined by two semicircles, driven counter-clockwise.
/// Local frame in metres: x = east, y = north, centred on the track's middle.
#[derive(Debug, Clone, Copy)]
pub struct Track {
    pub straight_m: f64,
    pub radius_m: f64,
    pub center_lat: f64,
    pub center_lon: f64,
}

pub struct Pose {
    pub x: f64,
    pub y: f64,
    /// Compass heading: 0 = north, clockwise.
    pub heading_deg: f64,
    pub in_curve: bool,
    /// Distance left on the current straight (0 in curves).
    pub straight_left_m: f64,
}

impl Track {
    pub fn new(center_lat: f64, center_lon: f64) -> Self {
        Self {
            straight_m: 250.0,
            radius_m: 30.0,
            center_lat,
            center_lon,
        }
    }

    pub fn length(&self) -> f64 {
        2.0 * self.straight_m + 2.0 * PI * self.radius_m
    }

    pub fn pose(&self, s: f64) -> Pose {
        let (l, r) = (self.straight_m, self.radius_m);
        let arc = PI * r;
        let s = s.rem_euclid(self.length());
        let (x, y, dx, dy, in_curve, straight_left_m) = if s < l {
            // Bottom straight, heading east.
            (-l / 2.0 + s, -r, 1.0, 0.0, false, l - s)
        } else if s < l + arc {
            // Right-hand semicircle, turning left.
            let th = -PI / 2.0 + (s - l) / r;
            (
                l / 2.0 + r * th.cos(),
                r * th.sin(),
                -th.sin(),
                th.cos(),
                true,
                0.0,
            )
        } else if s < 2.0 * l + arc {
            // Top straight, heading west.
            let d = s - l - arc;
            (l / 2.0 - d, r, -1.0, 0.0, false, l - d)
        } else {
            // Left-hand semicircle, turning left.
            let th = PI / 2.0 + (s - 2.0 * l - arc) / r;
            (
                -l / 2.0 + r * th.cos(),
                r * th.sin(),
                -th.sin(),
                th.cos(),
                true,
                0.0,
            )
        };
        let heading_deg = f64::atan2(dx, dy).to_degrees().rem_euclid(360.0);
        Pose {
            x,
            y,
            heading_deg,
            in_curve,
            straight_left_m,
        }
    }

    /// Converts local metres to WGS84 (flat-earth approximation, fine for a few hundred metres).
    pub fn lat_lon(&self, x: f64, y: f64) -> (f64, f64) {
        let lat = self.center_lat + y / EARTH_M_PER_DEG;
        let lon = self.center_lon + x / (EARTH_M_PER_DEG * self.center_lat.to_radians().cos());
        (lat, lon)
    }
}

/// SplitMix64: tiny, seedable, good enough for sensor noise.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [0, 1).
    pub fn uniform(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Normal distribution (Box–Muller).
    pub fn gauss(&mut self, sigma: f64) -> f64 {
        let u1 = self.uniform().max(f64::MIN_POSITIVE);
        let u2 = self.uniform();
        sigma * (-2.0 * u1.ln()).sqrt() * (2.0 * PI * u2).cos()
    }
}

pub struct Kart {
    track: Track,
    mode: DriveMode,
    rng: Rng,

    // State
    t_s: f64,
    pub s_m: f64,
    pub v_mps: f64,
    pub laps: u32,
    lap_pace: f64,
    soc_pct: f64,
    power_avg_w: f64,
    temp_battery: f64,
    temp_motor: [f64; 2],
    temp_esc: [f64; 2],

    // Outputs of the last step
    throttle_pct: f64,
    brake_pct: f64,
    power_w: f64,
    current_a: f64,
    voltage_v: f64,
    rpm: [f64; 2],
}

impl Kart {
    pub fn new(track: Track, mode: DriveMode, seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let lap_pace = 0.92 + 0.08 * rng.uniform();
        Self {
            track,
            mode,
            rng,
            t_s: 0.0,
            s_m: 0.0,
            v_mps: 0.0,
            laps: 0,
            lap_pace,
            soc_pct: 100.0,
            power_avg_w: 0.0,
            temp_battery: AMBIENT_C,
            temp_motor: [AMBIENT_C; 2],
            temp_esc: [AMBIENT_C; 2],
            throttle_pct: 0.0,
            brake_pct: 0.0,
            power_w: AUX_POWER_W,
            current_a: 0.0,
            voltage_v: open_circuit_voltage(100.0),
            rpm: [0.0; 2],
        }
    }

    fn target_speed(&self, pose: &Pose) -> f64 {
        let (_, top_speed) = self.mode.limits();
        let top_speed = top_speed * self.lap_pace;
        let curve_speed = (LATERAL_GRIP * self.track.radius_m).sqrt().min(top_speed);
        if pose.in_curve {
            curve_speed
        } else {
            // Brake in time to enter the next curve at curve speed.
            (curve_speed.powi(2) + 2.0 * BRAKE_DECEL * pose.straight_left_m)
                .sqrt()
                .min(top_speed)
        }
    }

    pub fn step(&mut self, dt: f64) {
        let pose = self.track.pose(self.s_m);
        let (max_accel, _) = self.mode.limits();
        let v = self.v_mps;
        let resistance = 0.5 * AIR_DENSITY * CDA_M2 * v * v / MASS_KG + ROLLING_RESISTANCE * G;
        let error = self.target_speed(&pose) - v;

        // Driver: feed-forward against resistance plus a proportional term.
        let mut throttle = ((resistance + 2.0 * error) / max_accel * 100.0).clamp(0.0, 100.0);
        let mut drive_accel = throttle / 100.0 * max_accel;
        // The ESC limits electrical power.
        let max_drive_accel =
            (MAX_ELECTRIC_POWER_W - AUX_POWER_W) * DRIVETRAIN_EFFICIENCY / (MASS_KG * v.max(0.1));
        if drive_accel > max_drive_accel {
            drive_accel = max_drive_accel;
            throttle = drive_accel / max_accel * 100.0;
        }
        let brake_accel = if error < -0.3 {
            (-error * 4.0).min(BRAKE_DECEL)
        } else {
            0.0
        };

        let accel = drive_accel - resistance - brake_accel;
        self.t_s += dt;
        self.v_mps = (v + accel * dt).max(0.0);
        self.s_m += self.v_mps * dt;
        if self.s_m >= self.track.length() {
            self.s_m -= self.track.length();
            self.laps += 1;
            self.lap_pace = 0.92 + 0.08 * self.rng.uniform();
        }

        // Electrical
        let regen_w = (REGEN_SHARE * MASS_KG * brake_accel * v).min(MAX_REGEN_POWER_W);
        self.power_w = MASS_KG * drive_accel * v / DRIVETRAIN_EFFICIENCY + AUX_POWER_W - regen_w;
        let ocv = open_circuit_voltage(self.soc_pct);
        self.current_a = self.power_w / ocv;
        self.voltage_v = ocv - self.current_a * PACK_INTERNAL_RESISTANCE;
        self.soc_pct -= self.power_w * dt / PACK_CAPACITY_J * 100.0;
        if self.soc_pct < 5.0 {
            // Pit stop: swap the pack so the sim can run forever.
            self.soc_pct = 100.0;
        }
        self.throttle_pct = throttle;
        self.brake_pct = brake_accel / BRAKE_DECEL * 100.0;

        // Motors: inner wheel turns slower in curves (both curves are left turns).
        let wheel_rpm = |v: f64| v / WHEEL_CIRCUMFERENCE_M * 60.0;
        let k = if pose.in_curve {
            TRACK_WIDTH_M / 2.0 / self.track.radius_m
        } else {
            0.0
        };
        self.rpm = [
            wheel_rpm(self.v_mps * (1.0 - k)),
            wheel_rpm(self.v_mps * (1.0 + k)),
        ];

        // Thermal: first-order lags towards a power-dependent steady state.
        self.power_avg_w = lag(self.power_avg_w, self.power_w.max(0.0), 10.0, dt);
        let p_kw = self.power_avg_w / 1000.0;
        self.temp_battery = lag(self.temp_battery, AMBIENT_C + 2.5 * p_kw, 400.0, dt);
        self.temp_motor[0] = lag(self.temp_motor[0], AMBIENT_C + 7.0 * p_kw, 90.0, dt);
        self.temp_motor[1] = lag(self.temp_motor[1], AMBIENT_C + 7.4 * p_kw, 90.0, dt);
        self.temp_esc[0] = lag(self.temp_esc[0], AMBIENT_C + 5.0 * p_kw, 45.0, dt);
        self.temp_esc[1] = lag(self.temp_esc[1], AMBIENT_C + 4.8 * p_kw, 45.0, dt);
    }

    /// Current reading of a catalog signal, with sensor noise. `None` if the sim
    /// doesn't produce this signal.
    pub fn measure(&mut self, signal: &str) -> Option<f64> {
        let speed_kmh = self.v_mps * 3.6;
        let bool = |b: bool| if b { 1.0 } else { 0.0 };
        let value = match signal {
            "battery.voltage" => self.voltage_v + self.rng.gauss(0.05),
            "battery.current" => self.current_a + self.rng.gauss(0.5),
            "battery.temp" => {
                let hottest = TEMP_SENSOR_OFFSETS_C.iter().copied().fold(0.0, f64::max);
                self.temp_battery + hottest + self.rng.gauss(0.1)
            }
            "battery.soc" => (self.soc_pct * 10.0).round() / 10.0,
            "battery.power" => self.power_w / 1000.0 + self.rng.gauss(0.01),
            "battery.voltage_ctrl_left" | "battery.voltage_ctrl_right" => self.voltage_v.round(),
            name if name.starts_with("battery.temp_") => {
                let n: usize = name["battery.temp_".len()..].parse().ok()?;
                let offset = TEMP_SENSOR_OFFSETS_C.get(n.checked_sub(1)?)?;
                self.temp_battery + offset + self.rng.gauss(0.1)
            }
            "drive.throttle" => self.throttle_pct,
            "drive.rpm_left" => (self.rpm[0] + self.rng.gauss(2.0)).max(0.0),
            "drive.rpm_right" => (self.rpm[1] + self.rng.gauss(2.0)).max(0.0),
            "drive.speed" => speed_kmh,
            "drive.drive_mode" => self.mode as u8 as f64,
            "drive.reverse" => 0.0,
            "drive.throttle_raw_left" | "drive.throttle_raw_right" => {
                (self.throttle_pct * 2.55).round()
            }
            "drive.brake_raw_left" | "drive.brake_raw_right" => (self.brake_pct * 2.55).round(),
            "drive.brake_switch_left" | "drive.brake_switch_right" => bool(self.brake_pct > 0.0),
            "drive.foot_switch_left" | "drive.foot_switch_right" => bool(self.throttle_pct > 1.0),
            "drive.forward_switch_left" | "drive.forward_switch_right" => 1.0,
            "drive.reverse_switch_left" | "drive.reverse_switch_right" => 0.0,
            "drive.setting_dir_left" | "drive.setting_dir_right" => 1.0,
            "drive.actual_dir_left" | "drive.actual_dir_right" => 1.0,
            "drive.relay_1" => 1.0,
            "drive.relay_2" => 0.0,
            "drive.phase_current_raw_left" | "drive.phase_current_raw_right" => {
                (self.current_a.max(0.0) / 2.0 * 10.0).round()
            }
            "lights.turn_left" => {
                let pose = self.track.pose(self.s_m);
                let indicating = !pose.in_curve && pose.straight_left_m < INDICATE_BEFORE_CURVE_M;
                bool(indicating && self.t_s % BLINK_PERIOD_S < BLINK_PERIOD_S / 2.0)
            }
            "lights.turn_right" | "lights.high_beam_left" | "lights.high_beam_right" => 0.0,
            "lights.brake" => bool(self.brake_pct > 0.0),
            "lights.reverse" => 0.0,
            "lights.drl" | "lights.tail" => 1.0,
            "gps.lat" | "gps.lon" => {
                let pose = self.track.pose(self.s_m);
                let (lat, lon) = self
                    .track
                    .lat_lon(pose.x + self.rng.gauss(0.3), pose.y + self.rng.gauss(0.3));
                if signal == "gps.lat" { lat } else { lon }
            }
            "gps.heading" => {
                (self.track.pose(self.s_m).heading_deg + self.rng.gauss(0.5)).rem_euclid(360.0)
            }
            "gps.speed" => (speed_kmh + self.rng.gauss(0.2)).max(0.0),
            "temp.motor_left" => self.temp_motor[0] + self.rng.gauss(0.1),
            "temp.motor_right" => self.temp_motor[1] + self.rng.gauss(0.1),
            "temp.esc_left" => self.temp_esc[0] + self.rng.gauss(0.1),
            "temp.esc_right" => self.temp_esc[1] + self.rng.gauss(0.1),
            _ => return None,
        };
        Some(value)
    }
}

/// 16s Li-ion pack: 51.2 V (empty) … 67.2 V (full), as configured on the headunit.
fn open_circuit_voltage(soc_pct: f64) -> f64 {
    16.0 * (3.2 + 1.0 * soc_pct / 100.0)
}

fn lag(current: f64, target: f64, tau_s: f64, dt: f64) -> f64 {
    current + (target - current) * (dt / tau_s).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track() -> Track {
        Track::new(48.0, 11.0)
    }

    #[test]
    fn track_is_closed_and_continuous() {
        let t = track();
        let start = t.pose(0.0);
        let end = t.pose(t.length() - 1e-9);
        assert!((start.x - end.x).abs() < 1e-6 && (start.y - end.y).abs() < 1e-6);

        let mut prev = t.pose(0.0);
        let mut s = 0.0;
        while s < t.length() {
            s += 0.5;
            let p = t.pose(s);
            let jump = ((p.x - prev.x).powi(2) + (p.y - prev.y).powi(2)).sqrt();
            assert!(jump < 0.51, "discontinuity at s = {s}: {jump} m");
            prev = p;
        }
    }

    #[test]
    fn every_catalog_signal_is_simulated_and_within_limits() {
        for mode in [
            DriveMode::Eco,
            DriveMode::Comfort,
            DriveMode::Sport,
            DriveMode::Ludicrous,
        ] {
            let mut kart = Kart::new(track(), mode, 7);
            // 40 simulated minutes at 100 Hz, long enough to warm up and swap a pack.
            for i in 0..(40 * 60 * 100) {
                kart.step(0.01);
                if i % 10 != 0 {
                    continue;
                }
                for sig in telemetry_schema::signals() {
                    let v = kart
                        .measure(&sig.name)
                        .unwrap_or_else(|| panic!("{} is not simulated", sig.name));
                    assert!(
                        v.is_finite() && v >= sig.min && v <= sig.max,
                        "{mode:?}: {} = {v} outside [{}, {}] at t = {} s",
                        sig.name,
                        sig.min,
                        sig.max,
                        i as f64 / 100.0
                    );
                }
            }
            assert!(
                kart.laps > 10,
                "{mode:?}: only {} laps in 40 min",
                kart.laps
            );
        }
    }
}
