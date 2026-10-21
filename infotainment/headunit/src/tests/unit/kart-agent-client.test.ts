import fs from "fs";
import path from "path";
import { AgentStatusSchema } from "@/services/kart-agent/schema";
import { getStatus, KartAgentError, putConfig } from "@/main/kart-agent-client";
import { formPatch } from "@/components/telemetry/telemetry-config-dialog";
import { carNetwork, overall, recording, uplink } from "@/services/kart-agent/health";

// Written by analytics/crates/kart-agent/tests/status_fixture.rs from the agent's Status type.
const FIXTURE = path.resolve(
    __dirname,
    "../../../../../analytics/crates/kart-agent/tests/fixtures/status.json"
);

const mockFetch = (impl: () => Promise<unknown>) => {
    (globalThis as { fetch: unknown }).fetch = jest.fn(impl);
};

test("the agent's status fixture matches the schema", () => {
    const status = AgentStatusSchema.parse(JSON.parse(fs.readFileSync(FIXTURE, "utf8")));
    expect(status.live.connected).toBe(true);
    expect(status.sero.services.map((s) => s.name)).toEqual(["lights", "motor"]);
});

test("an unreachable agent gives a clear error", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(getStatus()).rejects.toThrow(KartAgentError);
});

test("putConfig sends a JSON merge patch and reports agent errors", async () => {
    mockFetch(() =>
        Promise.resolve({
            ok: false,
            status: 422,
            json: () => Promise.resolve({ error: "bad batch_ms" }),
        })
    );
    await expect(putConfig({ live: { batch_ms: 5 } })).rejects.toThrow("bad batch_ms");
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:7411/v1/config");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ live: { batch_ms: 5 } });
});

test("formPatch only sends changed, trimmed fields", () => {
    const saved = { kart_id: "kart-01", broker_url: "", interface: "eth0" };
    expect(formPatch(saved, saved)).toEqual({});
    expect(formPatch(saved, { ...saved, broker_url: " mqtt://pit:1883 " })).toEqual({
        live: { broker_url: "mqtt://pit:1883" },
    });
    expect(formPatch(saved, { ...saved, kart_id: "kart-01 ", interface: "eth1" })).toEqual({
        sero: { interface: "eth1" },
    });
});

const fixture = () => AgentStatusSchema.parse(JSON.parse(fs.readFileSync(FIXTURE, "utf8")));

test("a recording, connected kart is green with the broker host as detail", () => {
    const status = fixture();
    expect(recording(status)).toEqual({ tone: "ok", state: "Recording", detail: "20.0 GB free" });
    expect(uplink(status)).toEqual({ tone: "ok", state: "Connected", detail: "10.0.0.1:1883" });
    expect(overall(status, null)).toBe("ok");
});

test("the header turns red when nothing is recorded, whatever the uplink does", () => {
    const status = fixture();
    status.log.active_segment = null;
    status.log.last_error = "opening a log segment: Permission denied";
    expect(recording(status)).toMatchObject({ tone: "fault", state: "Not recording" });
    expect(overall(status, null)).toBe("fault");
    expect(overall(fixture(), "kart-agent is not reachable")).toBe("fault");
    expect(overall(null, null)).toBe("unknown");
});

test("a switched-off uplink is neutral, not a warning", () => {
    const status = fixture();
    status.live.enabled = false;
    expect(uplink(status)).toEqual({ tone: "off", state: "Off" });
    expect(overall(status, null)).toBe("off");
});

test("car network counts ECUs that are found and subscribed", () => {
    const status = fixture();
    expect(carNetwork(status)).toEqual({ tone: "warn", state: "1 / 2 ECUs" });
    status.sero.state = "waiting_for_interface";
    expect(carNetwork(status)).toEqual({ tone: "warn", state: "No network", detail: "eth0 is down" });
});
