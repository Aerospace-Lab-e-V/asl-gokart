import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EcuControllerPage from "@/pages/ecu-controller";
import { EcuPresence, EcuStatusMap, OtaPhase, OtaProgress } from "@/data/ecu/ecu-types";
import { useStore } from "@/stores/useStore";

const online: EcuPresence = { online: true, ip: "192.168.1.21", changedAt: 0 };
const offline: EcuPresence = { online: false, changedAt: 0 };

const statusMap = (patch: Partial<EcuStatusMap> = {}): EcuStatusMap => ({
    zc_buttons: online,
    zc_lights: online,
    zc_battery: online,
    zc_motor: online,
    ...patch,
});

const RELEASE = {
    tag: "v0.4.17",
    version: "v0.4.17",
    publishedAt: "2026-10-01T00:00:00Z",
    downloadUrl: "https://example.invalid/fw.bin",
    isPrerelease: false,
};

let pushProgress: (p: OtaProgress) => void = () => {};

const firmware = (status: EcuStatusMap) => ({
    getReleases: jest.fn().mockResolvedValue([RELEASE]),
    getCachedVersions: jest.fn().mockResolvedValue({ zc_lights: ["v0.4.17"] }),
    getFlashHistory: jest.fn().mockResolvedValue({ zc_lights: { tag: "v0.4.15", flashedAt: "" } }),
    getEcuStatus: jest.fn().mockResolvedValue(status),
    onEcuStatus: jest.fn(() => () => {}),
    getOtaProgress: jest.fn().mockResolvedValue(null),
    onOtaProgress: jest.fn((cb: (p: OtaProgress) => void) => {
        pushProgress = cb;
        return () => {};
    }),
    downloadFirmware: jest.fn(),
    triggerOta: jest.fn().mockResolvedValue({ success: true, url: "" }),
});

const renderPage = async (status: EcuStatusMap, speed = 0) => {
    const api = firmware(status);
    Object.assign(window, { firmware: api, sero: { onBatteryMessage: () => () => {} } });
    useStore.setState({ speed });
    render(
        <MemoryRouter initialEntries={["/ecu-manager/zc_lights"]}>
            <Routes>
                <Route path="/ecu-manager/:id" element={<EcuControllerPage />} />
            </Routes>
        </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("radio", { name: /v0\.4\.17/ }));
    return api;
};

const flashButton = () => screen.getByRole("button", { name: /Flash v0\.4\.17/ });

test("an online controller of a stationary kart can be flashed after confirming", async () => {
    const api = await renderPage(statusMap());

    fireEvent.click(flashButton());
    expect(screen.getByText("Flash the Lights Controller")).toBeInTheDocument();
    expect(api.triggerOta).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Flash now/ })));
    expect(api.triggerOta).toHaveBeenCalledWith("zc_lights", "v0.4.17");

    act(() => pushProgress({ ecuId: "zc_lights", tag: "v0.4.17", phase: OtaPhase.Online }));
    expect(await screen.findByText(/is back online/)).toBeInTheDocument();
});

test("an offline controller cannot be flashed", async () => {
    await renderPage(statusMap({ zc_lights: offline }));
    expect(flashButton()).toBeDisabled();
    expect(screen.getByText("ECU offline")).toBeInTheDocument();
});

test("a moving kart cannot flash, unless the motor controller is offline", async () => {
    await renderPage(statusMap(), 12);
    expect(flashButton()).toBeDisabled();
    expect(screen.getByText("Stop the kart to flash")).toBeInTheDocument();
});

test("speed is ignored while the motor controller is offline", async () => {
    await renderPage(statusMap({ zc_motor: offline }), 12);
    expect(flashButton()).toBeEnabled();
});

test("a failed flash shows the error at the step that failed", async () => {
    await renderPage(statusMap());
    fireEvent.click(flashButton());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Flash now/ })));

    act(() =>
        pushProgress({
            ecuId: "zc_lights",
            tag: "v0.4.17",
            phase: OtaPhase.Failed,
            failedPhase: OtaPhase.Rebooting,
            error: "The ECU restarted but did not come back.",
        })
    );
    expect(await screen.findByText("The ECU restarted but did not come back.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
});
