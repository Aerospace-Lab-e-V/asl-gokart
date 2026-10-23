/** One step of an exponential moving average towards `target`, `dtMs` after the last one; `tauMs` is the time constant. */
export const emaStep = (prev: number, target: number, dtMs: number, tauMs: number): number =>
    prev + (target - prev) * (1 - Math.exp(-dtMs / tauMs));

/**
 * Whole number to show for `smoothed`: keeps `shown` until `smoothed` is more than `band` away from it, so a value
 * hovering at x.5 does not flip between two numbers. A band of 0.5 is plain rounding.
 */
export const holdRounded = (shown: number | null, smoothed: number, band: number): number =>
    shown !== null && Math.abs(smoothed - shown) <= band ? shown : Math.round(smoothed);
