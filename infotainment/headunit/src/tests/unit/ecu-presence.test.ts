import {
    getEcuStatus,
    markServiceFound,
    markServiceLost,
    onEcuPresenceChange,
    resetEcuPresence,
} from "@/helpers/ipc/firmware/ecu-presence";

const LIGHTS = 0x0001;

afterEach(resetEcuPresence);

test("every ECU starts offline", () => {
    expect(Object.values(getEcuStatus()).every((p) => !p.online)).toBe(true);
    expect(Object.keys(getEcuStatus())).toEqual(["zc_buttons", "zc_lights", "zc_battery", "zc_motor"]);
});

test("found brings an ECU online with its IP, lost takes it offline", () => {
    markServiceFound(LIGHTS, "192.168.1.21");
    expect(getEcuStatus().zc_lights).toMatchObject({ online: true, ip: "192.168.1.21" });

    markServiceLost(LIGHTS);
    expect(getEcuStatus().zc_lights.online).toBe(false);
    expect(getEcuStatus().zc_lights.ip).toBeUndefined();
});

test("listeners hear about known ECUs only", () => {
    const listener = jest.fn();
    const remove = onEcuPresenceChange(listener);

    markServiceFound(0x0042, "192.168.1.99");
    expect(listener).not.toHaveBeenCalled();

    markServiceFound(LIGHTS, "192.168.1.21");
    expect(listener).toHaveBeenCalledWith("zc_lights", expect.objectContaining({ online: true }));

    remove();
    markServiceLost(LIGHTS);
    expect(listener).toHaveBeenCalledTimes(1);
});

test("a reset takes every ECU offline", () => {
    markServiceFound(LIGHTS, "192.168.1.21");
    resetEcuPresence();
    expect(getEcuStatus().zc_lights.online).toBe(false);
});
