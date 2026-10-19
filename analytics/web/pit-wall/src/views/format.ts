import type { SignalDef, SignalName } from "../live/catalog";

/** Short display names; the catalog descriptions are written for engineers. */
const LABELS: Partial<Record<SignalName, string>> = {
    "battery.voltage": "Voltage",
    "battery.current": "Current",
    "battery.temp": "Battery temp",
    "battery.soc": "State of charge",
    "battery.power": "Power",
    "drive.throttle": "Throttle",
    "drive.rpm_left": "RPM left",
    "drive.rpm_right": "RPM right",
    "drive.speed": "Speed",
    "drive.drive_mode": "Drive mode",
    "drive.reverse": "Gear",
    "gps.speed": "GPS speed",
    "temp.motor_left": "Motor left",
    "temp.motor_right": "Motor right",
    "temp.esc_left": "ESC left",
    "temp.esc_right": "ESC right",
};

/** Labels for enum and bool signals, sent as numbers (see schema/signals.yaml). */
const VALUE_LABELS: Partial<Record<SignalName, readonly string[]>> = {
    "drive.drive_mode": ["Eco", "Comfort", "Sport", "Ludicrous"],
    "drive.reverse": ["Forward", "Reverse"],
};

const DECIMALS: Record<string, number> = {
    V: 1,
    A: 1,
    kW: 2,
    "%": 0,
    "°C": 0,
    rpm: 0,
    "km/h": 0,
    deg: 5,
};

export function label(def: SignalDef): string {
    return LABELS[def.name as SignalName] ?? def.description.split(",")[0]!;
}

/** Unit shown next to a value; none for enums and bools. */
export function unit(def: SignalDef): string {
    return def.unit === "enum" || def.unit === "bool" ? "" : def.unit;
}

export function formatValue(def: SignalDef, value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    const names = VALUE_LABELS[def.name as SignalName];
    if (names) return names[Math.round(value)] ?? String(value);
    return value.toFixed(DECIMALS[def.unit] ?? 1);
}

/** Data age for the status bar: ms below 10 s, then seconds, minutes. */
export function formatAge(ms: number | null): string {
    if (ms === null) return "—";
    if (ms < 10_000) return `${Math.max(0, Math.round(ms))} ms`;
    if (ms < 120_000) return `${Math.round(ms / 1000)} s`;
    return `${Math.round(ms / 60_000)} min`;
}

/** Relative time axis labels: 0 → "now", −90 000 → "−1:30". */
export function formatRelative(ms: number): string {
    const s = Math.round(-ms / 1000);
    if (s <= 0) return "now";
    return `−${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
