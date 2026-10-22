mod sim;

use std::{cell::RefCell, rc::Rc, time::{Duration, Instant}};

slint::include_modules!();

fn main() -> Result<(), slint::PlatformError> {
    let ui = DriveWindow::new()?;
    if std::env::args().any(|a| a == "--light") {
        ui.global::<Theme>().set_dark(false);
    }

    let sim = Rc::new(RefCell::new(sim::Sim::new()));
    ui.on_toggle_light({
        let sim = sim.clone();
        move |light| sim.borrow_mut().toggle(&light)
    });

    // 100 ms, the rate the Electron mock steps and emits at.
    let timer = slint::Timer::default();
    let start = Instant::now();
    let mut last = start;
    let weak = ui.as_weak();
    timer.start(slint::TimerMode::Repeated, Duration::from_millis(100), move || {
        let Some(ui) = weak.upgrade() else { return };
        let now = Instant::now();
        let mut sim = sim.borrow_mut();
        sim.step((now - last).as_secs_f64());
        last = now;
        let s = sim.signals(start.elapsed().as_millis() as u64);
        ui.set_speed(s.speed as f32);
        ui.set_rpm(s.rpm as f32);
        ui.set_throttle(s.throttle as f32);
        ui.set_reverse(s.reverse);
        ui.set_soc(s.soc as f32);
        ui.set_battery_temp(s.battery_temp as f32);
        ui.set_motor_temp(s.motor_temp as f32);
        ui.set_esc_left(s.esc_left as f32);
        ui.set_esc_right(s.esc_right as f32);
        ui.set_turn_left(s.turn_left);
        ui.set_turn_right(s.turn_right);
        ui.set_drl(sim.drl);
        ui.set_high_beam(sim.high_beam);
        ui.set_tail(sim.tail);
        ui.set_hazard(sim.hazard);
        ui.set_clock(chrono::Local::now().format("%H:%M").to_string().into());
    });

    ui.run()
}
