import { act, render, screen } from "@testing-library/react";
import React from "react";
import DriveNormalPage from "@/pages/drive-normal";
import { gearFor, tempTone } from "@/components/drive/lamps";
import { Gears } from "@/data/controlling_models/drivetrain";
import { EcuPresence, EcuStatusMap } from "@/data/ecu/ecu-types";
import type { SignalName } from "@/domain/signals";
import { useSignals } from "@/stores/signals";

jest.mock("@/components/shared/header-bar", () => ({ HeaderBar: () => null }));

const online: EcuPresence = { online: true, ip: "192.168.1.21", changedAt: 0 };
const offline: EcuPresence = { online: false, changedAt: 0 };

const renderPage = async (patch: Partial<EcuStatusMap>, signals: Partial<Record<SignalName, number>> = {}) => {
    const status: EcuStatusMap = { zc_buttons: online, zc_lights: online, zc_battery: online, zc_motor: online, ...patch };
    Object.assign(window, {
        api: { firmware: { getEcuStatus: jest.fn().mockResolvedValue(status), onEcuStatus: jest.fn(() => () => {}) } },
    });
    useSignals.setState(
        Object.fromEntries(Object.entries(signals).map(([name, value]) => [name, { value, ts: 0, stale: false }])),
        true
    );
    render(<DriveNormalPage />);
    await act(async () => {});
};

test("temperature lamps: yellow from the warning threshold, red above the hot one", () => {
    expect(tempTone(null, 35, 45)).toBeNull();
    expect(tempTone(34.9, 35, 45)).toBeNull();
    expect(tempTone(35, 35, 45)).toBe("yellow");
    expect(tempTone(45, 35, 45)).toBe("yellow");
    expect(tempTone(45.1, 35, 45)).toBe("red");
});

test("gear is P until the contactors close, then N or R", () => {
    expect(gearFor(null, null)).toBe(Gears.p);
    expect(gearFor(0, 0)).toBe(Gears.p);
    expect(gearFor(0, 1)).toBe(Gears.p);
    expect(gearFor(1, 0)).toBe(Gears.n);
    expect(gearFor(1, null)).toBe(Gears.n);
    expect(gearFor(1, 1)).toBe(Gears.r);
});

test("a controller that is not connected lights its lamp red", async () => {
    await renderPage({ zc_battery: offline, zc_lights: offline });

    expect(screen.getByRole("img", { name: "Battery controller not connected" })).toHaveClass("text-red-600");
    expect(screen.queryByRole("img", { name: "Motor controller not connected" })).toBeNull();
    expect(screen.getByRole("button", { name: "hazard lights" }).querySelector("svg")).toHaveClass("text-red-600");
    expect(screen.getByRole("button", { name: "tail lights" }).querySelector("svg")).not.toHaveClass("text-red-600");
});

test("warning lamps stay hidden while off; light buttons stay visible", async () => {
    await renderPage({});

    for (const lamp of ["hv-battery-fault", "motor-fault", "battery-temperature", "motor-temperature", "power-limited"]) {
        expect(document.querySelector(`.telltale-${lamp}`)).toHaveClass("invisible");
    }
    expect(document.querySelector(".telltale-inverter-fault")).toBeNull();
    for (const name of ["daytime running lights", "high beams", "tail lights", "hazard lights", "left turn signal", "right turn signal"]) {
        expect(screen.getByRole("button", { name }).querySelector("svg")).toHaveClass("text-muted-foreground/60");
    }
});

test("hot battery and motor light their temperature lamps", async () => {
    await renderPage({}, { "battery.temp": 46, "temp.motor_left": 42, "temp.motor_right": 30 });

    expect(screen.getByRole("img", { name: "Battery temperature high" })).toHaveClass("text-red-600");
    expect(screen.getByRole("img", { name: "Motor temperature high" })).toHaveClass("text-yellow-500");
    expect(screen.queryByRole("img", { name: "Power limited" })).toBeNull();
});

test("closed contactors show N", async () => {
    await renderPage({}, { "drive.relay_1": 1, "drive.reverse": 0 });

    expect(screen.getByText("N")).toHaveClass("font-semibold");
    expect(screen.getByText("P")).not.toHaveClass("font-semibold");
});
