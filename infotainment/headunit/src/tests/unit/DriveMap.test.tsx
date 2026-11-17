import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { DriveMap } from "@/components/drive/map/drive-map";
import { TILE_RETRY_MS } from "@/data/map-config";
import type { SignalBatch } from "@/domain/signals";
import { useSignals } from "@/stores/signals";

const fresh = (value: number) => ({ value, ts: 0, stale: false });
const set = (batch: SignalBatch) => act(() => useSignals.setState(batch));
const atTrack = { "gps.satellites": fresh(9), "gps.lat": fresh(48.5941), "gps.lon": fresh(8.866), "gps.speed": fresh(0), "gps.heading": fresh(90) };

/** Runs a few animation frames, so the map draws the current position. */
const frames = () => act(() => jest.advanceTimersByTime(50));
const tiles = () => [...document.querySelectorAll<HTMLImageElement>("[data-level] img")];
/** The tile under the kart: nearest first, and the only one in view of the zero-size jsdom panel. */
const centerTile = () => tiles()[0];

beforeEach(() => {
    jest.useFakeTimers();
    useSignals.setState({}, true);
    document.documentElement.classList.remove("dark");
});

afterEach(() => jest.useRealTimers());

test("says GPS is unavailable while kart-agent sends nothing", () => {
    render(<DriveMap />);
    expect(screen.getByText("GPS unavailable")).toBeInTheDocument();
    expect(tiles()).toHaveLength(0);
});

test("shows the satellite count while waiting for a fix", () => {
    render(<DriveMap />);
    set({ "gps.satellites": fresh(4), "gps.fix": fresh(0) });
    expect(screen.getByText("Waiting for GPS fix")).toBeInTheDocument();
    expect(screen.getByText("4 satellites")).toBeInTheDocument();
});

test("loads with the rings, then shows the map with the arrow and attribution", () => {
    render(<DriveMap />);
    set(atTrack);
    frames();
    expect(screen.getByText("Loading map…")).toBeInTheDocument();
    expect(screen.queryByText(/OpenStreetMap/)).toBeNull();
    // z18.5 at a standstill: level 19 drawn scaled down, so the roads stay sharp.
    expect(centerTile().src).toMatch(/^maptiles:\/\/light\/19\/\d+\/\d+$/);

    act(() => fireEvent.load(centerTile()));
    expect(screen.queryByText("Loading map…")).toBeNull();
    expect(screen.getByText("© OpenMapTiles © OpenStreetMap")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
});

test("says there is no offline map when the view cannot be filled, and shows one downloaded meanwhile", () => {
    render(<DriveMap />);
    set(atTrack);
    frames();
    const src = centerTile().src;
    act(() => fireEvent.error(centerTile()));
    expect(screen.getByText("No offline map for this area")).toBeInTheDocument();
    expect(screen.getByText("Download it in Settings → Offline maps")).toBeInTheDocument();

    // The retry keeps the placeholder up instead of blinking back to the loader.
    act(() => jest.advanceTimersByTime(TILE_RETRY_MS));
    expect(screen.getByText("No offline map for this area")).toBeInTheDocument();
    expect(screen.queryByText("Loading map…")).toBeNull();

    // A failed <img> is replaced by a fresh one for the same tile; the pack now has it.
    const retried = tiles().filter((img) => img.src === src);
    expect(retried).toHaveLength(1);
    act(() => fireEvent.load(retried[0]));
    expect(screen.queryByText("No offline map for this area")).toBeNull();
    expect(screen.getByText("© OpenMapTiles © OpenStreetMap")).toBeInTheDocument();
});

test("a failed tile outside the view keeps the map", () => {
    render(<DriveMap />);
    set(atTrack);
    frames();
    act(() => fireEvent.load(centerTile()));
    act(() => fireEvent.error(tiles().at(-1)!));
    expect(screen.queryByText("No offline map for this area")).toBeNull();
    expect(screen.getByText("© OpenMapTiles © OpenStreetMap")).toBeInTheDocument();
});

test("follows the kart even when fixes arrive faster than frames are drawn", () => {
    render(<DriveMap />);
    set(atTrack);
    frames();
    const translate = () => document.querySelector<HTMLElement>("[data-level]")!.style.transform.match(/translate\(([^)]*)\)$/)![1];
    const start = translate();
    // A new fix before every frame, e.g. on a busy Pi: each ease must start from where the last one got to.
    for (let i = 1; i <= 5; i++) {
        set({ "gps.lon": fresh(8.866 + i * 0.0001) });
        act(() => jest.advanceTimersByTime(16));
    }
    expect(translate()).not.toBe(start);
});

test("dims the arrow and says GPS lost while the position is stale", () => {
    render(<DriveMap />);
    set(atTrack);
    frames();
    act(() => fireEvent.load(centerTile()));
    set({ "gps.lat": { value: 48.5941, ts: 0, stale: true } });
    expect(screen.getByText("GPS lost")).toBeInTheDocument();
    expect(document.querySelector("svg.opacity-30")).not.toBeNull();
});

test("follows the theme, keeping the old tiles until the new ones load", async () => {
    render(<DriveMap />);
    set(atTrack);
    frames();
    act(() => fireEvent.load(centerTile()));

    act(() => document.documentElement.classList.add("dark"));
    await act(async () => {});
    frames();
    const dark = tiles().filter((img) => img.src.startsWith("maptiles://dark/"));
    expect(dark.length).toBeGreaterThan(0);
    // Old light tiles stay underneath, so the map does not go blank or show the loader.
    expect(tiles().some((img) => img.src.startsWith("maptiles://light/"))).toBe(true);
    expect(screen.queryByText("Loading map…")).toBeNull();

    act(() => fireEvent.load(dark[0]));
    expect(tiles().every((img) => img.src.startsWith("maptiles://dark/"))).toBe(true);
});
