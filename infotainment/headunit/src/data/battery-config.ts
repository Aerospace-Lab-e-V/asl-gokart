import { Segment } from "@/data/gauge-config";

export const BATTERY_MIN_VOLTAGE = 51.2;
export const BATTERY_MAX_VOLTAGE = 67.2;

/** State of charge (%) at or below which the battery shows amber, then red. */
export const SOC_WARN_PCT = 25;
export const SOC_LOW_PCT = 10;

/**
 * Pack temperature sensors as a grid, battery.temp_1 top left, row by row.
 * zc_battery numbers them in 1-Wire discovery order, so the positions are only physical once that is mapped.
 */
export const THERMAL_GRID = { cols: 2, rows: 5 };

export const TEMP_BOUNDARIES: [number, number] = [0, 45];

/**
 * Thermal map and legend colours by °C: `calm` (the theme's track colour) around a comfortable pack, blue when
 * cold, amber to red when hot. No green, that is the charge colour.
 */
export const tempSegments = (calm: string): Segment[] => [
    { value: 0,  color: "#3b82f6" }, // blue-500
    { value: 22, color: calm },
    { value: 35, color: "#f59e0b" }, // amber-500
    { value: 45, color: "#dc2626" }, // red-600
];
