import {
    checkTimeouts,
    flush,
    get,
    getFresh,
    markEcuLost,
    onBatch,
    publish,
    resetSignalHub,
    snapshot,
} from "@/main/signal-hub";

afterEach(resetSignalHub);

test("changes are batched until flush, repeats are not resent", () => {
    const listener = jest.fn();
    onBatch(listener);
    publish("battery.voltage", 60, 1);
    publish("battery.voltage", 61, 2);
    publish("lights.drl", 1, 2);
    expect(listener).not.toHaveBeenCalled();

    flush();
    expect(listener).toHaveBeenCalledWith({
        "battery.voltage": { value: 61, ts: 2, stale: false },
        "lights.drl": { value: 1, ts: 2, stale: false },
    });

    publish("battery.voltage", 61, 3);
    flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(get("battery.voltage")?.ts).toBe(3);
});

test("null or non-finite clears a signal", () => {
    const listener = jest.fn();
    onBatch(listener);
    publish("battery.temp_min", 20, 1);
    publish("battery.temp_min", null, 2);
    flush();
    expect(listener).toHaveBeenCalledWith({ "battery.temp_min": null });
    expect(get("battery.temp_min")).toBeUndefined();

    publish("battery.temp_avg", NaN, 3);
    expect(snapshot()).toEqual({});
});

test("periodic signals go stale after their timeout, on-change signals do not", () => {
    publish("drive.speed", 12, 0);
    publish("lights.drl", 1, 0);
    checkTimeouts(500);
    expect(getFresh("drive.speed")).toBe(12);

    checkTimeouts(1500);
    expect(getFresh("drive.speed")).toBeUndefined();
    expect(get("drive.speed")).toMatchObject({ value: 12, stale: true });
    expect(getFresh("lights.drl")).toBe(1);

    publish("drive.speed", 12, 1600);
    expect(getFresh("drive.speed")).toBe(12);
});

test("losing an ECU marks only its signals stale", () => {
    publish("drive.speed", 5, 0);
    publish("lights.drl", 1, 0);
    markEcuLost("zc_lights");
    expect(getFresh("lights.drl")).toBeUndefined();
    expect(getFresh("drive.speed")).toBe(5);
});
