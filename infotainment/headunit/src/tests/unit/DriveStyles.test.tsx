import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Gauge, LifeBuoy } from "lucide-react";
import NavBar from "@/components/navbar/navbar";
import DrivePage from "@/pages/drive";
import { EcuPresence } from "@/data/ecu/ecu-types";
import { BULB_CHECK_MS, resetBulbCheck } from "@/hooks/use-bulb-check";
import { setDriveStyle, setDriveStylePickerOpen, useSession } from "@/stores/session";

jest.mock("@/components/shared/header-bar", () => ({ HeaderBar: () => null }));

const online: EcuPresence = { online: true, ip: "192.168.1.21", changedAt: 0 };

beforeEach(() => {
    jest.useFakeTimers();
    resetBulbCheck();
    useSession.setState({ driveStyle: "classic", driveStylePickerOpen: false });
    Object.assign(window, {
        api: {
            firmware: {
                getEcuStatus: jest.fn().mockResolvedValue({ zc_buttons: online, zc_lights: online, zc_battery: online, zc_motor: online }),
                onEcuStatus: jest.fn(() => () => {}),
            },
        },
    });
});

afterEach(() => jest.useRealTimers());

const renderDrive = async ({ bulbCheck = false } = {}) => {
    render(<DrivePage />);
    await act(async () => {});
    if (!bulbCheck) act(() => jest.advanceTimersByTime(BULB_CHECK_MS));
};

const Location = () => <p data-testid="location">{useLocation().pathname}</p>;

const renderNavBar = (path: string, onReselect: () => void) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <NavBar items={[{ Icon: Gauge, label: "Drive", linkTo: "/", onReselect }, { Icon: LifeBuoy, label: "Motor", linkTo: "/motor" }]} />
            <Location />
        </MemoryRouter>
    );

test("tapping the active Drive item calls onReselect instead of navigating", () => {
    const onReselect = jest.fn();
    renderNavBar("/", onReselect);

    fireEvent.click(screen.getByRole("link", { name: "Drive" }));

    expect(onReselect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/");
});

test("tapping Drive from another page only navigates", () => {
    const onReselect = jest.fn();
    renderNavBar("/motor", onReselect);

    fireEvent.click(screen.getByRole("link", { name: "Drive" }));

    expect(onReselect).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
});

test("the picker lists the styles and switches to the one picked", async () => {
    await renderDrive();
    expect(screen.getByText("Throttle")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();

    act(() => setDriveStylePickerOpen(true));
    expect(screen.getByRole("radiogroup", { name: "Drive style" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Classic/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /^Minimal/ })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("radio", { name: /^Minimal/ }));

    expect(useSession.getState()).toMatchObject({ driveStyle: "minimal", driveStylePickerOpen: false });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    for (const text of ["Throttle", "RPM", "Motor", "Controller 1", "Controller 2"]) expect(screen.queryByText(text)).toBeNull();
    expect(screen.getByText("km/h")).toBeInTheDocument();
    expect(screen.getByText("Battery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "hazard lights" })).toBeInTheDocument();
});

test("switching styles during the bulb check keeps it running to its end", async () => {
    await renderDrive({ bulbCheck: true });
    const motorFault = () => document.querySelector(".telltale-motor-fault");
    expect(motorFault()).not.toHaveClass("invisible");

    act(() => jest.advanceTimersByTime(BULB_CHECK_MS / 2));
    act(() => setDriveStyle("minimal"));
    expect(motorFault()).not.toHaveClass("invisible");

    act(() => jest.advanceTimersByTime(BULB_CHECK_MS / 2));
    expect(motorFault()).toHaveClass("invisible");
});
