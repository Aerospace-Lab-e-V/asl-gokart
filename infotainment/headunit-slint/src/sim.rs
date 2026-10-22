//! Port of headunit/src/main/adapters/mock.ts: a driver loops one lap, the rest is physics.
//! Skips the Sero payload round trip and hands out the decoded signals directly.

/// `(t s, target km/h)`, linear in between, looping; negative is reverse.
const LAP: [(f64, f64); 13] = [
    (0., 0.), (3., 0.), (14., 95.), (17., 95.), (21., 30.), (29., 35.), (37., 65.),
    (42., 0.), (45., 0.), (46., -6.), (50., -6.), (51., 0.), (56., 0.),
];
const LAP_S: f64 = LAP[LAP.len() - 1].0;
/// `(from s, to s, left)`: the driver signals before the corner and before pulling over.
const SIGNALS: [(f64, f64, bool); 2] = [(15., 21., true), (36., 42., false)];

/// Motors drive the wheels directly, so motor rpm is wheel rpm (derive.ts).
const WHEEL_CIRCUMFERENCE_M: f64 = 1.415;
const KMH_PER_RPM: f64 = WHEEL_CIRCUMFERENCE_M * 3.6 / 60.;
const AMBIENT_C: f64 = 22.;
const CAPACITY_AH: f64 = 40.;
const PACK_OHM: f64 = 0.008;
const BATTERY_MIN_VOLTAGE: f64 = 51.2;
const BATTERY_MAX_VOLTAGE: f64 = 67.2;
const BLINK_MS: u64 = 400;
const TEMPS_EVERY_S: f64 = 2.;
/// Fixed sensor spread across the 10 pack sensors.
const CELL_OFFSETS: [f64; 10] = [-1.2, -0.4, 0.3, 0.8, 1.5, -0.8, 0.1, 0.6, -0.3, 1.1];

pub struct Sim {
    /// Lap time, s.
    pub t: f64,
    /// Signed, km/h.
    pub speed: f64,
    /// Pedals, 0-100 %.
    pub throttle: f64,
    pub brake: f64,
    pub reverse: bool,
    /// A; negative is drawn from the pack, positive is regen.
    pub current: f64,
    pub soc: f64,
    pub motor_temp: f64,
    pub esc_temp: f64,
    pub pack_temp: f64,
    since_temps: f64,
    /// Last pack sensor sample, sent every TEMPS_EVERY_S like zc_battery.
    battery_temp: f64,
    /// Lights the user toggled; the turn signals also follow the driver.
    pub drl: bool,
    pub high_beam: bool,
    pub tail: bool,
    pub hazard: bool,
    turn_left: bool,
    turn_right: bool,
}

/// What the drive page reads, as the Electron adapter would publish it.
pub struct Signals {
    pub speed: f64,
    pub rpm: f64,
    pub throttle: f64,
    pub reverse: bool,
    pub soc: f64,
    pub battery_temp: f64,
    pub motor_temp: f64,
    pub esc_left: f64,
    pub esc_right: f64,
    pub turn_left: bool,
    pub turn_right: bool,
}

pub fn lap_target(t: f64) -> f64 {
    let i = LAP.iter().position(|&(at, _)| at > t).unwrap_or(LAP.len() - 1);
    let ((t0, v0), (t1, v1)) = (LAP[i - 1], LAP[i]);
    v0 + (t - t0) / (t1 - t0) * (v1 - v0)
}

fn approach(v: f64, to: f64, max_step: f64) -> f64 {
    v + (to - v).clamp(-max_step, max_step)
}

impl Sim {
    pub fn new() -> Self {
        Sim {
            t: 0., speed: 0., throttle: 0., brake: 0., reverse: false, current: 0., soc: 88.,
            motor_temp: 24., esc_temp: 23., pack_temp: AMBIENT_C, since_temps: TEMPS_EVERY_S, battery_temp: AMBIENT_C,
            drl: true, high_beam: false, tail: true, hazard: false, turn_left: false, turn_right: false,
        }
    }

    /// Advances the kart by `dt` seconds.
    pub fn step(&mut self, dt: f64) {
        self.t = (self.t + dt) % LAP_S;
        let target = lap_target(self.t);
        let v = self.speed.abs();
        // The direction only changes at a standstill.
        if v < 0.3 && target != 0. {
            self.reverse = target < 0.;
        }
        let wanted = if target.signum() == if self.reverse { -1. } else { 1. } { target.abs() } else { 0. };

        // Driver: hold-speed feed-forward plus a proportional term, pedals moved at a human rate.
        let drag = if v > 0.1 { 0.5 + 0.002 * v * v } else { 0. };
        let err = wanted - v;
        let throttle = if err > -2. && wanted > 0. { (drag / 0.18 + err * 8.).clamp(0., if self.reverse { 25. } else { 100. }) } else { 0. };
        let brake = f64::max(if err < -1. { ((-err - 1.) * 10.).clamp(0., 100.) } else { 0. }, if wanted == 0. && v > 0.3 { 30. } else { 0. });
        self.throttle = approach(self.throttle, throttle, 250. * dt);
        self.brake = approach(self.brake, brake, 400. * dt);

        // km/h per s: full throttle is 0-80 in about 6 s, top speed about 93.
        let accel = self.throttle * 0.18 - drag - self.brake * 0.4;
        let next = f64::max(0., v + accel * dt);
        self.speed = if self.reverse { -next } else { next };

        let draw = self.throttle * 1.6;
        let regen = self.brake * 0.6 * f64::min(1., next / 20.);
        self.current = regen - draw - 1.5;
        self.soc += self.current * dt * 100. / 3600. / CAPACITY_AH;
        // ponytail: a "charged" pack after every few laps, so the low-SoC states show up during a dev session.
        if self.soc < 12. {
            self.soc = 90.;
        }

        let i2 = self.current * self.current;
        self.motor_temp += (0.00004 * i2 - (self.motor_temp - AMBIENT_C) / 90.) * dt;
        self.esc_temp += (0.00003 * i2 - (self.esc_temp - AMBIENT_C) / 60.) * dt;
        self.pack_temp += (0.000005 * i2 - (self.pack_temp - AMBIENT_C) / 600.) * dt;

        self.since_temps += dt;
        if self.since_temps >= TEMPS_EVERY_S {
            self.since_temps = 0.;
            self.battery_temp = self.pack_temp + CELL_OFFSETS.iter().sum::<f64>() / CELL_OFFSETS.len() as f64;
        }
    }

    /// Answers lights.toggle (Electron's ToggleLight names) like the firmware: the turn signals exclude each other.
    pub fn toggle(&mut self, light: &str) {
        match light {
            "turn_left" => (self.turn_left, self.turn_right) = (!self.turn_left, false),
            "turn_right" => (self.turn_left, self.turn_right) = (false, !self.turn_right),
            "hazard" => self.hazard = !self.hazard,
            "high_beam" => self.high_beam = !self.high_beam,
            "drl" => self.drl = !self.drl,
            "tail" => self.tail = !self.tail,
            _ => {}
        }
    }

    pub fn signals(&self, now_ms: u64) -> Signals {
        let blink = (now_ms / BLINK_MS) % 2 == 1;
        let signal = SIGNALS.iter().find(|&&(from, to, _)| self.t >= from && self.t < to).map(|s| s.2);
        let voltage = BATTERY_MIN_VOLTAGE + (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE) * self.soc / 100. + self.current * PACK_OHM;
        // Temps travel as whole degrees per side; the right side runs 0.7 warmer.
        let motor = (self.motor_temp.round() + (self.motor_temp + 0.7).round()) / 2.;
        Signals {
            speed: self.speed.abs(),
            rpm: self.speed.abs() / KMH_PER_RPM,
            throttle: (self.throttle * 2.55).round().clamp(0., 255.) / 2.55,
            reverse: self.reverse,
            soc: ((voltage - BATTERY_MIN_VOLTAGE) / (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE) * 100.).clamp(0., 100.),
            battery_temp: self.battery_temp,
            motor_temp: motor,
            esc_left: self.esc_temp.round(),
            esc_right: (self.esc_temp + 0.7).round(),
            turn_left: blink && (self.hazard || self.turn_left || signal == Some(true)),
            turn_right: blink && (self.hazard || self.turn_right || signal == Some(false)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_laps_stay_physical() {
        let mut s = Sim::new();
        let (mut top, mut reversed, mut prev_reverse) = (0f64, false, false);
        for _ in 0..(3. * LAP_S / 0.1) as usize {
            s.step(0.1);
            if s.reverse != prev_reverse {
                assert!(s.speed.abs() < 0.3, "direction changed at {} km/h", s.speed);
                prev_reverse = s.reverse;
            }
            reversed |= s.reverse;
            top = top.max(s.speed);
            assert!((12. ..=90.).contains(&s.soc));
            assert!(s.speed > -10.);
        }
        assert!((80. ..100.).contains(&top), "top speed {top}");
        assert!(reversed);
        assert_eq!(lap_target(14.), 95.);
        assert_eq!(lap_target(8.5), 47.5);
    }
}
