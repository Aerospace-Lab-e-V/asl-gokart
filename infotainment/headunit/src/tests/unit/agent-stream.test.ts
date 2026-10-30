/** @jest-environment node */
import fs from "fs";
import path from "path";

jest.mock("electron-log/main", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import {
    handleEvent,
    parseSse,
    startAgentStream,
    stopAgentStream,
    type SseEvent,
} from "@/main/adapters/kart-agent";
import { get, resetSignalHub } from "@/main/signal-hub";

// Written by analytics/crates/kart-agent/tests/api.rs (stream_fixture) from the agent's real SSE output.
const FIXTURE = path.resolve(
    __dirname,
    "../../../../../analytics/crates/kart-agent/tests/fixtures/stream.sse"
);
const wire = fs.readFileSync(FIXTURE, "utf8");

afterEach(() => {
    stopAgentStream();
    resetSignalHub();
});

async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(condition()).toBe(true);
}

test("the agent's stream fixture parses the same in any chunking", () => {
    for (const size of [1, 7, 64, wire.length]) {
        let buffer = "";
        const events: SseEvent[] = [];
        for (let i = 0; i < wire.length; i += size) {
            const parsed = parseSse(buffer + wire.slice(i, i + size));
            buffer = parsed.rest;
            events.push(...parsed.events);
        }
        expect(buffer).toBe("");
        expect(events.map((e) => e.event)).toEqual(["samples", "samples"]);
    }
});

test("gps samples reach the hub with the agent's time; zone-controller signals are left to the Sero adapter", () => {
    parseSse(wire).events.forEach(handleEvent);
    expect(get("gps.lat")).toEqual({ value: 48.59412, ts: 1792400001000, stale: false });
    expect(get("gps.satellites")?.value).toBe(9);
    expect(get("battery.voltage")).toBeUndefined();
});

test("keep-alives, unknown events and malformed frames are skipped", () => {
    const { events } = parseSse(
        ':\n\nevent: lap\ndata: {}\n\nevent: samples\ndata: {nope\n\nevent: samples\ndata: {"t_us":1,"samples":{"gps.fix":"3"}}\n\n'
    );
    expect(events).toHaveLength(3);
    expect(() => events.forEach(handleEvent)).not.toThrow();
    expect(get("gps.fix")).toBeUndefined();
});

test("a lost connection marks the agent's signals stale and reconnects", async () => {
    const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(new Response(wire))
        .mockRejectedValue(new TypeError("fetch failed"));
    globalThis.fetch = fetchMock;

    startAgentStream();
    await until(() => get("gps.lat")?.stale === true);
    expect(get("gps.lat")?.value).toBe(48.59412);
    await until(() => fetchMock.mock.calls.length >= 2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:7411/v1/stream");
});
