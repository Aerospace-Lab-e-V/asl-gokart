import { act, render, screen } from "@testing-library/react";
import React from "react";
import DrivePage from "@/pages/drive";
import type { DriveStyleId } from "@/pages/drive/styles";
import { gearFor, tempTone } from "@/components/drive/lamps";
import { Gears } from "@/data/controlling_models/drivetrain";
import { EcuPresence, EcuStatusMap } from "@/data/ecu/ecu-types";
import type { SignalName } from "@/domain/signals";
import { useSignals } from "@/stores/signals";
import { BULB_CHECK_MS, resetBulbCheck } from "@/hooks/use-bulb-check";
import { useSession } from "@/stores/session";

jest.mock("@/components/shared/header-bar", () => ({ HeaderBar: () => null }));

const online: EcuPresence = { online: true, ip: "192.168.1.21", changedAt: 0 };
const offline: EcuPresence = { online: false, changedAt: 0 };

beforeEach(() => {
    jest.useFakeTimers();
    resetBulbCheck();
});

afterEach(() => jest.useRealTimers());

const finishBulbCheck = () => act(() => jest.advanceTimersByTime(BULB_CHECK_MS));

const renderPage = async (patch: Partial<EcuStatusMap>, signals: Partial<Record<SignalName, number>> = {}, { bulbCheck = false } = {}) => {
    const status: EcuStatusMap = { zc_buttons: online, zc_lights: online, zc_battery: online, zc_motor: online, ...patch };
    Object.assign(window, {
        api: { firmware: { getEcuStatus: jest.fn().mockResolvedValue(status), onEcuStatus: jest.fn(() => () => {}) } },
    });
    useSignals.setState(
        Object.fromEntries(Object.entries(signals).map(([name, value]) => [name, { value, ts: 0, stale: false }])),
        true
    );
    const view = render(<DrivePage />);
    await act(async () => {});
    if (!bulbCheck) finishBulbCheck();
    return view;
};

const WARNING_LAMPS = ["hv-battery-fault", "motor-fault", "battery-temperature", "motor-temperature", "power-limited"];
const lamp = (name: string) => document.querySelector(`.telltale-${name}`);

test("temperature lamps: yellow from the warning threshold, red above the hot one", () => {
    expect(tempTone(null, 35, 45)).toBeNull();
    expect(tempTone(34.9, 35, 45)).toBeNull();
    expect(tempTone(35, 35, 45)).toBe("yellow");
    expect(tempTone(45, 35, 45)).toBe("yellow");
    expect(tempTone(45.1, 35, 45)).toBe("red");
});

test("gear is N until the contactors close, then D, or R once the controllers report reverse", () => {
    expect(gearFor(null, null)).toBe(Gears.n);
    expect(gearFor(0, 0)).toBe(Gears.n);
    expect(gearFor(0, 1)).toBe(Gears.n);
    expect(gearFor(1, 0)).toBe(Gears.d);
    expect(gearFor(1, null)).toBe(Gears.d);
    expect(gearFor(1, 1)).toBe(Gears.r);
});

/* Every style shows all warning lamps, light buttons and the gear strip. */
const STYLES: DriveStyleId[] = ["classic", "minimal"];

describe.each(STYLES)("%s style", (driveStyle) => {
    beforeEach(() => useSession.setState({ driveStyle }));

    test("a controller that is not connected lights its lamp red", async () => {
        await renderPage({ zc_battery: offline, zc_lights: offline });

        expect(screen.getByRole("img", { name: "Battery controller not connected" })).toHaveClass("text-red-600", "animate-lamp-blink");
        expect(screen.queryByRole("img", { name: "Motor controller not connected" })).toBeNull();
        expect(screen.getByRole("button", { name: "hazard lights" }).querySelector("svg")).toHaveClass("text-red-600", "animate-lamp-blink");
        expect(screen.getByRole("button", { name: "tail lights" }).querySelector("svg")).not.toHaveClass("text-red-600");
    });

    test("warning lamps stay hidden while off; light buttons stay visible", async () => {
        await renderPage({});

        for (const name of WARNING_LAMPS) expect(lamp(name)).toHaveClass("invisible");
        expect(lamp("inverter-fault")).toBeNull();
        for (const name of ["daytime running lights", "high beams", "tail lights", "hazard lights", "left turn signal", "right turn signal"]) {
            expect(screen.getByRole("button", { name }).querySelector("svg")).toHaveClass("text-muted-foreground/60");
        }
    });

    test("hot battery and motor light their temperature lamps", async () => {
        await renderPage({}, { "battery.temp": 46, "temp.motor_left": 42, "temp.motor_right": 30 });

        expect(screen.getByRole("img", { name: "Battery temperature high" })).toHaveClass("text-red-600");
        expect(screen.getByRole("img", { name: "Battery temperature high" })).toHaveClass("animate-lamp-blink");
        expect(screen.getByRole("img", { name: "Motor temperature high" })).toHaveClass("text-yellow-500");
        expect(screen.getByRole("img", { name: "Motor temperature high" })).not.toHaveClass("animate-lamp-blink");
        expect(screen.queryByRole("img", { name: "Power limited" })).toBeNull();
    });

    test("closed contactors show D", async () => {
        await renderPage({}, { "drive.relay_1": 1, "drive.reverse": 0 });

        expect(screen.getByText("D")).toHaveClass("font-semibold");
        expect(screen.getByText("N")).not.toHaveClass("font-semibold");
    });

    test("relay 2 alone does not show R; the controllers' reverse report does", async () => {
        const { unmount } = await renderPage({}, { "drive.relay_1": 1, "drive.relay_2": 1, "drive.reverse": 0 });
        expect(screen.getByText("R")).not.toHaveClass("font-semibold");
        unmount();

        await renderPage({}, { "drive.relay_1": 1, "drive.relay_2": 1, "drive.reverse": 1 });
        expect(screen.getByText("R")).toHaveClass("font-semibold");
    });

    test("the bulb check lights every warning lamp for 5 s, once per app start", async () => {
        const { unmount } = await renderPage({ zc_battery: offline }, {}, { bulbCheck: true });

        for (const name of WARNING_LAMPS) expect(lamp(name)).not.toHaveClass("invisible");
        expect(lamp("power-limited")).toHaveClass("text-orange-500");
        expect(lamp("motor-fault")).toHaveClass("text-red-600");
        // A fault already present blinks once the check is over, not underneath it.
        expect(lamp("hv-battery-fault")).not.toHaveClass("animate-lamp-blink");

        finishBulbCheck();
        expect(lamp("motor-fault")).toHaveClass("invisible");
        expect(lamp("hv-battery-fault")).toHaveClass("text-red-600", "animate-lamp-blink");

        unmount();
        await renderPage({}, {}, { bulbCheck: true });
        expect(lamp("motor-fault")).toHaveClass("invisible");
    });
});
