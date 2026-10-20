import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import NetworkGateScreen from "@/components/shared/network-gate-screen";
import type { NetworkGateStatus } from "@/helpers/ipc/network-gate";

const START = new Date("2026-01-01T12:00:00Z").getTime();

const status = (patch: Partial<NetworkGateStatus> = {}): NetworkGateStatus => ({
    ready: false,
    mac: "aa:bb:cc:dd:ee:ff",
    waitingSince: START,
    lastCheck: START,
    interfaces: [
        { name: "eth0", mac: "AA:BB:CC:DD:EE:FF", ipv4: null },
        { name: "wlan0", mac: "11:22:33:44:55:66", ipv4: "192.168.1.20" },
    ],
    ...patch,
});

const skip = jest.fn();
const close = jest.fn();

beforeEach(() => {
    jest.useFakeTimers({ now: START });
    Object.assign(window, { api: { networkGate: { skip }, window: { close } } });
});

afterEach(() => {
    jest.useRealTimers();
});

const openEngineerInfo = () =>
    fireEvent.click(screen.getByRole("button", { name: "Engineer info" }));

test("keeps engineer info collapsed on boot", () => {
    render(<NetworkGateScreen status={status()} />);

    expect(screen.getByRole("heading", { name: "Connecting to car" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Engineer info" })).toHaveAttribute(
        "aria-expanded",
        "false"
    );
    expect(document.getElementById("network-gate-engineer-info")).toHaveAttribute("inert");
});

test("hints at the cable once waiting takes longer than usual", () => {
    render(<NetworkGateScreen status={status()} />);
    expect(screen.queryByText(/taking longer than usual/i)).not.toBeInTheDocument();

    act(() => jest.advanceTimersByTime(31_000));

    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
});

test("shows diagnostics and marks the car network interface", () => {
    render(<NetworkGateScreen status={status()} />);
    openEngineerInfo();
    act(() => jest.advanceTimersByTime(65_000));

    expect(document.getElementById("network-gate-engineer-info")).not.toHaveAttribute("inert");
    expect(screen.getByText("aa:bb:cc:dd:ee:ff")).toBeInTheDocument();
    expect(screen.getByText("1m 05s")).toBeInTheDocument();
    expect(screen.getByText("(car)")).toBeInTheDocument();
    expect(screen.getByText("no address")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.20")).toBeInTheDocument();
});

test("quits only on a second tap", () => {
    render(<NetworkGateScreen status={status()} />);
    openEngineerInfo();

    fireEvent.click(screen.getByRole("button", { name: /quit app/i }));
    expect(close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /tap again to quit/i }));
    expect(close).toHaveBeenCalledTimes(1);
});

test("skip disarms again when the second tap does not come", () => {
    render(<NetworkGateScreen status={status()} />);
    openEngineerInfo();

    fireEvent.click(screen.getByRole("button", { name: /skip network check/i }));
    act(() => jest.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole("button", { name: /skip network check/i }));

    expect(skip).not.toHaveBeenCalled();
});
