import { tempSegments } from "@/data/battery-config";
import { tempRgb, tempScalePct, thermalField } from "@/lib/utils/thermal";

test("temperature colours follow the scale, calm at 22 °C, and clamp at its ends", () => {
    const segments = tempSegments("#808080");
    expect(tempRgb(22, segments)).toEqual([0x80, 0x80, 0x80]);
    expect(tempRgb(0, segments)).toEqual([0x3b, 0x82, 0xf6]);
    expect(tempRgb(-20, segments)).toEqual([0x3b, 0x82, 0xf6]);
    expect(tempRgb(45, segments)).toEqual([0xdc, 0x26, 0x26]);
    expect(tempRgb(90, segments)).toEqual([0xdc, 0x26, 0x26]);
});

test("scale position is clamped to 0-100 %", () => {
    expect(tempScalePct(-5)).toBe(0);
    expect(tempScalePct(22.5)).toBe(50);
    expect(tempScalePct(60)).toBe(100);
});

test("the field reads each sensor at its cell centre and blends in between", () => {
    // 2 x 2 sensors on a 4 x 4 raster: pixel centres 0.5 and 2.5 sit a quarter cell from the sensor centres.
    const field = thermalField([10, 20, 30, 40], 2, 2, 4, 4)!;
    expect(field[0]).toBeCloseTo(10); // beyond the outer sensors it stays flat
    expect(field[3]).toBeCloseTo(20);
    expect(field[15]).toBeCloseTo(40);
    expect(field[1 * 4 + 1]).toBeCloseTo(10 * 0.5625 + 20 * 0.1875 + 30 * 0.1875 + 40 * 0.0625);
});

test("a uniform pack is uniform everywhere", () => {
    const field = thermalField(Array(10).fill(22), 2, 5, 24, 60)!;
    expect(Math.min(...field)).toBeCloseTo(22);
    expect(Math.max(...field)).toBeCloseTo(22);
});

test("a missing sensor takes the mean of the valid ones", () => {
    const field = thermalField([20, null, 20, 26], 2, 2, 2, 2)!;
    expect(field[1]).toBeCloseTo(22);
});

test("no valid sensor gives no field", () => {
    expect(thermalField([null, null], 2, 1, 4, 2)).toBeNull();
    expect(thermalField([], 2, 5, 4, 10)).toBeNull();
});
