import type { SignalName } from "../live/catalog";

export interface ChartDef {
    title: string;
    /** All series of one chart share a unit: one y-axis per chart, never two. */
    series: SignalName[];
    /** Fixed y range; otherwise the axis fits the visible data. */
    range?: [number, number];
}

export interface Preset {
    id: PresetId;
    label: string;
    tiles: SignalName[];
    charts: ChartDef[];
}

export type PresetId = "overview" | "battery" | "drivetrain" | "thermal";

const PERCENT: [number, number] = [0, 100];

// The views are fixed by design; adding a tile or chart is an edit here.
export const PRESETS: Record<PresetId, Preset> = {
    overview: {
        id: "overview",
        label: "Overview",
        tiles: [
            "drive.speed",
            "drive.throttle",
            "battery.voltage",
            "battery.current",
            "battery.power",
            "battery.soc",
            "battery.temp",
            "drive.drive_mode",
            "drive.reverse",
        ],
        charts: [
            { title: "Speed", series: ["drive.speed"] },
            { title: "Throttle", series: ["drive.throttle"], range: PERCENT },
            { title: "Pack voltage", series: ["battery.voltage"] },
            { title: "Pack current", series: ["battery.current"] },
            {
                title: "Temperatures",
                series: ["battery.temp", "temp.motor_left", "temp.motor_right"],
            },
        ],
    },
    battery: {
        id: "battery",
        label: "Battery",
        tiles: [
            "battery.voltage",
            "battery.current",
            "battery.power",
            "battery.soc",
            "battery.temp",
        ],
        charts: [
            { title: "Pack voltage", series: ["battery.voltage"] },
            { title: "Pack current", series: ["battery.current"] },
            { title: "Pack power", series: ["battery.power"] },
            { title: "State of charge", series: ["battery.soc"], range: PERCENT },
            { title: "Hottest cell", series: ["battery.temp"] },
        ],
    },
    drivetrain: {
        id: "drivetrain",
        label: "Drivetrain",
        tiles: [
            "drive.speed",
            "gps.speed",
            "drive.throttle",
            "drive.rpm_left",
            "drive.rpm_right",
            "drive.drive_mode",
            "drive.reverse",
        ],
        charts: [
            { title: "Speed", series: ["drive.speed", "gps.speed"] },
            { title: "Throttle", series: ["drive.throttle"], range: PERCENT },
            { title: "Motor speed", series: ["drive.rpm_left", "drive.rpm_right"] },
        ],
    },
    thermal: {
        id: "thermal",
        label: "Thermal",
        tiles: [
            "temp.motor_left",
            "temp.motor_right",
            "temp.esc_left",
            "temp.esc_right",
            "battery.temp",
        ],
        charts: [
            { title: "Motors", series: ["temp.motor_left", "temp.motor_right"] },
            { title: "ESCs", series: ["temp.esc_left", "temp.esc_right"] },
            { title: "Hottest cell", series: ["battery.temp"] },
        ],
    },
};

export const WINDOWS_MIN = [1, 5, 10] as const;
export type WindowMin = (typeof WINDOWS_MIN)[number];
export const DEFAULT_WINDOW_MIN: WindowMin = 5;
