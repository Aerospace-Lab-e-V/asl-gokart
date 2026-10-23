import { act, renderHook } from "@testing-library/react";
import { emaStep, holdRounded } from "@/lib/utils/smoothing";
import { useSmoothed } from "@/hooks/use-smoothed";

afterEach(() => jest.useRealTimers());

test("the average moves part of the way, more the longer the step", () => {
    expect(emaStep(10, 20, 0, 1000)).toBe(10);
    expect(emaStep(10, 20, 1000, 1000)).toBeCloseTo(10 + 10 * (1 - Math.exp(-1)));
    expect(emaStep(10, 20, 100_000, 1000)).toBeCloseTo(20);
});

test("the shown number holds until the average leaves the band", () => {
    expect(holdRounded(null, 12.6, 0.75)).toBe(13);
    expect(holdRounded(13, 12.3, 0.75)).toBe(13);
    expect(holdRounded(13, 13.7, 0.75)).toBe(13);
    expect(holdRounded(13, 13.8, 0.75)).toBe(14);
    expect(holdRounded(13, 12.2, 0.75)).toBe(12);
});

test("a reading flipping between 12 and 14 shows a steady 13", () => {
    jest.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useSmoothed(v), { initialProps: { v: 12 as number | null } });
    // The kart: a flip every 250-750 ms.
    const dwell = [250, 750, 500, 300, 700, 450, 600, 250, 750, 400];
    const shown = new Set<number | null>();
    let v = 12;
    for (let i = 0; i < 60; i++) {
        v = v === 12 ? 14 : 12;
        rerender({ v });
        act(() => jest.advanceTimersByTime(dwell[i % dwell.length]));
        // After the average settled (it starts at the first sample, 14).
        if (i >= 20) shown.add(result.current);
    }
    expect([...shown]).toEqual([13]);
});

test("a real change comes through within a few seconds", () => {
    jest.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useSmoothed(v), { initialProps: { v: 20 as number | null } });
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current).toBe(20);
    rerender({ v: 30 });
    act(() => jest.advanceTimersByTime(10_000));
    expect(result.current).toBe(30);
});

test("no value shows at once and the average restarts from the next one", () => {
    jest.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useSmoothed(v), { initialProps: { v: 20 as number | null } });
    act(() => jest.advanceTimersByTime(1000));
    rerender({ v: null });
    expect(result.current).toBeNull();
    act(() => jest.advanceTimersByTime(500));
    rerender({ v: 40 });
    act(() => jest.advanceTimersByTime(250));
    expect(result.current).toBe(40);
});
