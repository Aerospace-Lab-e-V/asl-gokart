import { act, renderHook } from "@testing-library/react";
import { useGpsFix } from "@/components/drive/map/use-gps-fix";
import { GPS_HOLD_MS } from "@/data/map-config";
import type { SignalBatch } from "@/domain/signals";
import { useSignals } from "@/stores/signals";

const fresh = (value: number) => ({ value, ts: 0, stale: false });
const stale = (value: number) => ({ value, ts: 0, stale: true });
const set = (batch: SignalBatch) => act(() => useSignals.setState(batch));

beforeEach(() => {
    jest.useFakeTimers();
    useSignals.setState({}, true);
});

afterEach(() => jest.useRealTimers());

test("unavailable while the receiver sends nothing", () => {
    const { result } = renderHook(() => useGpsFix());
    expect(result.current).toEqual({ kind: "unavailable" });

    set({ "gps.satellites": stale(7) });
    expect(result.current).toEqual({ kind: "unavailable" });
});

test("searching with the satellite count until a position arrives", () => {
    const { result } = renderHook(() => useGpsFix());
    set({ "gps.satellites": fresh(4), "gps.fix": fresh(0) });
    expect(result.current).toEqual({ kind: "searching", satellites: 4 });

    set({ "gps.satellites": fresh(9), "gps.lat": fresh(48.59) });
    expect(result.current).toEqual({ kind: "ok" });
});

test("a stale position is held as lost, then given up after the hold", () => {
    const { result } = renderHook(() => useGpsFix());
    set({ "gps.satellites": fresh(9), "gps.lat": fresh(48.59) });

    set({ "gps.lat": stale(48.59), "gps.satellites": stale(9) });
    expect(result.current).toEqual({ kind: "lost" });

    act(() => jest.advanceTimersByTime(GPS_HOLD_MS - 1));
    expect(result.current).toEqual({ kind: "lost" });
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toEqual({ kind: "unavailable" });

    // The receiver still sees satellites but lost the fix: searching, not unavailable.
    set({ "gps.satellites": fresh(5) });
    expect(result.current).toEqual({ kind: "searching", satellites: 5 });

    set({ "gps.lat": fresh(48.6) });
    expect(result.current).toEqual({ kind: "ok" });
});

test("a position that comes back during the hold cancels it", () => {
    const { result } = renderHook(() => useGpsFix());
    set({ "gps.lat": fresh(48.59) });
    set({ "gps.lat": stale(48.59) });
    act(() => jest.advanceTimersByTime(GPS_HOLD_MS / 2));
    set({ "gps.lat": fresh(48.6) });
    act(() => jest.advanceTimersByTime(GPS_HOLD_MS));
    expect(result.current).toEqual({ kind: "ok" });
});
