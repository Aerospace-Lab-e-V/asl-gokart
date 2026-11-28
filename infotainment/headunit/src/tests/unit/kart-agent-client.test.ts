import fs from "fs";
import path from "path";
import { AgentStatusSchema } from "@/services/kart-agent/schema";
import { getStatus, KartAgentError, putConfig, startEnrollment } from "@/main/kart-agent-client";
import { formPatch } from "@/components/telemetry/telemetry-config-dialog";
import { carNetwork, gps, identity, overall, recording, uplink } from "@/services/kart-agent/health";

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
    expect(status.gps).toMatchObject({ state: "running", fix: 3, satellites: 9 });
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
    const saved = { kart_id: "kart-01", broker_url: "", interface: "eth0", gps_enabled: true, gps_device: "" };
    expect(formPatch(saved, saved)).toEqual({});
    expect(formPatch(saved, { ...saved, broker_url: " mqtt://pit:1883 " })).toEqual({
        live: { broker_url: "mqtt://pit:1883" },
    });
    expect(formPatch(saved, { ...saved, kart_id: "kart-01 ", interface: "eth1" })).toEqual({
        sero: { interface: "eth1" },
    });
    expect(formPatch(saved, { ...saved, gps_enabled: false })).toEqual({ gps: { enabled: false } });
    expect(formPatch(saved, { ...saved, gps_device: " /dev/ttyACM1 " })).toEqual({
        gps: { device: "/dev/ttyACM1" },
    });
});

const fixture = () => AgentStatusSchema.parse(JSON.parse(fs.readFileSync(FIXTURE, "utf8")));

test("a recording, connected kart is green with the broker host as detail", () => {
    const status = fixture();
    expect(recording(status)).toEqual({ tone: "ok", state: "Recording", detail: "20.0 GB free" });
    expect(uplink(status)).toEqual({ tone: "ok", state: "Connected", detail: "kart.example.org" });
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

test("GPS shows the fix with satellites and HDOP, and warns without one", () => {
    const status = fixture();
    expect(gps(status)).toEqual({ tone: "ok", state: "3D fix", detail: "9 satellites · HDOP 0.9" });
    status.gps!.fix = 0;
    status.gps!.satellites = 1;
    status.gps!.hdop = null;
    expect(gps(status)).toEqual({ tone: "warn", state: "No fix", detail: "1 satellite" });
    status.gps!.state = "waiting_for_device";
    expect(gps(status)).toMatchObject({ tone: "warn", state: "Not connected" });
    status.gps!.state = "disabled";
    expect(gps(status)).toEqual({ tone: "off", state: "Off" });
    // GPS never changes the header: it is not needed to record.
    expect(overall(status, null)).toBe("ok");
});

test("an agent without GPS support has no GPS line", () => {
    const status = fixture();
    delete status.gps;
    expect(gps(status)).toBeNull();
});

test("the fixture's kart is enrolled", () => {
    const status = fixture();
    expect(status.enrollment).toMatchObject({ state: "enrolled", device_id: "kart-01" });
    const line = identity(status, status.enrollment!.not_after_s! - 365 * 86_400)!;
    expect(line.tone).toBe("ok");
    expect(line.state).toBe("Enrolled");
    expect(line.detail).toMatch(/^kart-01 · until /);
});

test("certificates close to expiry warn, expired ones are a fault", () => {
    const status = fixture();
    const end = status.enrollment!.not_after_s!;
    expect(identity(status, end - 10 * 86_400)).toMatchObject({ tone: "warn", state: "Expires soon" });
    expect(identity(status, end + 60)).toMatchObject({ tone: "fault", state: "Expired" });
});

test("not enrolled warns only when the uplink needs a certificate", () => {
    const status = fixture();
    status.enrollment = { ...status.enrollment!, state: "none", device_id: null, not_after_s: null };
    expect(identity(status)).toMatchObject({ tone: "warn", state: "Not enrolled" });
    status.live.broker_url = "mqtt://10.0.0.1:1883";
    expect(identity(status)).toMatchObject({ tone: "off", state: "Not enrolled" });
});

test("the uplink explains why it is not connected", () => {
    const status = fixture();
    status.live.connected = false;
    status.live.error = "not enrolled";
    expect(uplink(status)).toMatchObject({ tone: "warn", state: "Not enrolled" });
    status.live.error = "proxy refused the client certificate (HTTP 403)";
    expect(uplink(status)).toEqual({ tone: "warn", state: "Connecting", detail: status.live.error });
});

test("agents before enrollment have no identity line", () => {
    const status = fixture();
    delete status.enrollment;
    delete status.live.error;
    expect(identity(status)).toBeNull();
});

test("startEnrollment posts the requested id and returns the code", async () => {
    mockFetch(() =>
        Promise.resolve({
            ok: true,
            status: 202,
            json: () =>
                Promise.resolve({
                    state: "pending",
                    device_id: null,
                    not_after_s: null,
                    code: "AB12-CD34",
                    expires_at_s: 1,
                    requested_id: "kart-03",
                    error: null,
                }),
        })
    );
    await expect(startEnrollment("kart-03")).resolves.toMatchObject({ state: "pending", code: "AB12-CD34" });
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:7411/v1/enroll");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ requested_id: "kart-03" });
});
