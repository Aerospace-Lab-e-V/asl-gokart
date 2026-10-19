//! Whether the kernel clock is synchronised. The Pi has no RTC, so until NTP (or later
//! GPS) has set the clock, sample times are wrong; the status makes that visible.

use crate::status::ClockStatus;

pub fn status() -> ClockStatus {
    // SAFETY: modes = 0 only reads the kernel's time state.
    let mut tx: libc::timex = unsafe { std::mem::zeroed() };
    let state = unsafe { libc::adjtimex(&mut tx) };
    ClockStatus {
        synced: state >= 0 && state != libc::TIME_ERROR && tx.status & libc::STA_UNSYNC == 0,
        max_error_us: tx.maxerror as i64,
    }
}
