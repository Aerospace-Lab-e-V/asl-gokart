import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import OfflineMapsPage from "@/pages/settings/offline-maps";
import type { MapArea, MapPacksState } from "@/data/map-packs";

jest.mock("@/components/shared/header-bar", () => ({ HeaderBar: () => null }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const area = (over: Partial<MapArea> = {}): MapArea => ({
    id: "herrenberg",
    title: "Herrenberg",
    bytes: 12_300_000,
    installed: null,
    available: { version: "v2" },
    ...over,
});

const state = (over: Partial<MapPacksState> = {}): MapPacksState => ({
    server: "http://pit:8080/maps/",
    serverError: null,
    areas: [area()],
    download: null,
    ...over,
});

let push: (s: MapPacksState) => void;
const api = {
    list: jest.fn(),
    install: jest.fn(),
    cancel: jest.fn(),
    remove: jest.fn(),
    onState: jest.fn((cb: (s: MapPacksState) => void) => {
        push = cb;
        return () => {};
    }),
};

beforeEach(() => {
    Object.assign(window, { api: { mapPacks: api } });
    api.install.mockResolvedValue(undefined);
    api.remove.mockResolvedValue(undefined);
});

const renderPage = async (initial: MapPacksState) => {
    api.list.mockResolvedValue(initial);
    render(
        <MemoryRouter>
            <OfflineMapsPage />
        </MemoryRouter>
    );
    await act(async () => {});
};

test("offers the server's areas for download and shows the progress", async () => {
    await renderPage(state());
    expect(screen.getByText("Herrenberg")).toBeInTheDocument();
    expect(screen.getByText("12.3 MB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Download/ }));
    expect(api.install).toHaveBeenCalledWith("herrenberg");

    act(() => push(state({ download: { id: "herrenberg", bytes: 5_166_000, total: 12_300_000 } })));
    expect(screen.getByText("Downloading 42 % of 12.3 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(api.cancel).toHaveBeenCalled();
});

test("an installed area offers its update, and delete takes two taps", async () => {
    await renderPage(state({ areas: [area({ installed: { version: "v1", installedAt: Date.UTC(2026, 9, 31) } })] }));
    expect(screen.getByText("Update available · 12.3 MB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Tap again to delete/ }));
    expect(api.remove).toHaveBeenCalledWith("herrenberg");
});

test("an up-to-date area only offers delete", async () => {
    await renderPage(state({ areas: [area({ installed: { version: "v2", installedAt: Date.UTC(2026, 9, 31) } })] }));
    expect(screen.getByText(/^Downloaded .* · 12.3 MB$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download|Update/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
});

test("installed areas stay listed when the map server is not reachable", async () => {
    await renderPage(
        state({ serverError: "connect ECONNREFUSED", areas: [area({ installed: { version: "v1", installedAt: 0 }, available: null })] })
    );
    expect(screen.getByText("Map server not reachable: connect ECONNREFUSED")).toBeInTheDocument();
    expect(screen.getByText("Herrenberg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download|Update/ })).toBeNull();
});

test("says where the maps come from when there is no broker", async () => {
    await renderPage(state({ server: null, areas: [] }));
    expect(screen.getByText(/set the telemetry uplink's broker first/)).toBeInTheDocument();
});
