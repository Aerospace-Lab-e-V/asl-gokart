import { HAZARD_HOLD_MS, hazardFromTurn, powerKw, resetDerive, socFromVoltage, speedKmh, tempStats } from "@/main/derive";
import { flowStateFor } from "@/lib/utils/flow-state";
import { FlowState } from "@/domain/signals";

afterEach(() => {
    resetDerive();
    jest.useRealTimers();
});

test("speed from mean rpm, as ecu-sero derives it", () => {
    // 505 rpm / 60 x 1.415 m x 3.6
    expect(speedKmh(500, 510)).toBeCloseTo(42.8745, 3);
});

test("soc is linear between the voltage limits and clamped", () => {
    expect(socFromVoltage(59.2)).toBeCloseTo(50);
    expect(socFromVoltage(40)).toBe(0);
    expect(socFromVoltage(80)).toBe(100);
});

test("power needs both values fresh and younger than the hold time", () => {
    const v = { value: 60, ts: 0, stale: false };
    const c = { value: 50, ts: 0, stale: false };
    expect(powerKw(v, c, 1000)).toBe(3);
    expect(powerKw(v, c, 6000)).toBeNull();
    expect(powerKw({ ...v, stale: true }, c, 1000)).toBeNull();
    expect(powerKw(undefined, c, 1000)).toBeNull();
});

test("temperature stats are null without a valid sensor", () => {
    expect(tempStats([])).toEqual({ max: null, min: null, avg: null });
    expect(tempStats([20, 30])).toEqual({ max: 30, min: 20, avg: 25 });
});

test("flow state keeps the current sign behavior (A1)", () => {
    expect(flowStateFor(2)).toBe(FlowState.IDLE);
    expect(flowStateFor(20)).toBe(FlowState.REGEN);
    expect(flowStateFor(-20)).toBe(FlowState.POWER);
});

test("hazard holds through the blink-off phase and drops after the hold", () => {
    jest.useFakeTimers();
    const set = jest.fn();
    hazardFromTurn(0, 0, set);
    expect(set).toHaveBeenLastCalledWith(0);

    hazardFromTurn(1, 1, set);
    expect(set).toHaveBeenLastCalledWith(1);
    hazardFromTurn(0, 0, set);
    jest.advanceTimersByTime(HAZARD_HOLD_MS - 100);
    hazardFromTurn(1, 1, set);
    hazardFromTurn(0, 0, set);
    jest.advanceTimersByTime(HAZARD_HOLD_MS - 100);
    expect(set).toHaveBeenLastCalledWith(1);

    jest.advanceTimersByTime(200);
    expect(set).toHaveBeenLastCalledWith(0);
});

test("a single-side blink ends hazard at once", () => {
    jest.useFakeTimers();
    const set = jest.fn();
    hazardFromTurn(1, 1, set);
    hazardFromTurn(1, 0, set);
    expect(set).toHaveBeenLastCalledWith(0);
    hazardFromTurn(0, 0, set);
    expect(set).toHaveBeenLastCalledWith(0);
});
