import { describe, expect, it } from "vitest";
import { signal } from "../live/catalog";
import { formatAge, formatRelative, formatValue, label } from "./format";
import { PRESETS } from "./presets";

describe("presets", () => {
    it("keep one unit per chart (one y-axis)", () => {
        for (const preset of Object.values(PRESETS)) {
            for (const chart of preset.charts) {
                const units = new Set(chart.series.map((n) => signal(n).unit));
                expect(units.size, `${preset.id}/${chart.title}`).toBe(1);
            }
        }
    });

    it("stay within the validated colour slots", () => {
        for (const preset of Object.values(PRESETS)) {
            for (const chart of preset.charts) expect(chart.series.length).toBeLessThanOrEqual(4);
        }
    });
});

describe("format", () => {
    it("formats numbers by unit and enums by name", () => {
        expect(formatValue(signal("battery.voltage"), 48.24)).toBe("48.2");
        expect(formatValue(signal("drive.speed"), 41.6)).toBe("42");
        expect(formatValue(signal("drive.drive_mode"), 2)).toBe("Sport");
        expect(formatValue(signal("drive.reverse"), 1)).toBe("Reverse");
        expect(formatValue(signal("drive.speed"), undefined)).toBe("—");
        expect(formatValue(signal("drive.speed"), NaN)).toBe("—");
    });

    it("labels signals", () => {
        expect(label(signal("battery.voltage"))).toBe("Voltage");
    });

    it("formats data age and relative time", () => {
        expect(formatAge(null)).toBe("—");
        expect(formatAge(183.4)).toBe("183 ms");
        expect(formatAge(15_000)).toBe("15 s");
        expect(formatRelative(0)).toBe("now");
        expect(formatRelative(-90_000)).toBe("−1:30");
    });
});
