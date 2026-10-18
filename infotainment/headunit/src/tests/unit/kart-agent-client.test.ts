// The page module imports react-router, which needs browser APIs jsdom lacks.
jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }));

import fs from "fs";
import path from "path";
import { AgentStatusSchema } from "@/services/kart-agent/schema";
import { getStatus, KartAgentError, putConfig } from "@/services/kart-agent/client";
import { formPatch } from "@/pages/telemetry";

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

test("formPatch only sends changed fields and rejects bad numbers", () => {
    const saved = {
        kart_id: "kart-01",
        broker_url: "",
        batch_ms: "50",
        interface: "eth0",
        client_id: "0x0010",
        port: "30492",
    };
    expect(formPatch(saved, { ...saved, broker_url: "mqtt://pit:1883" })).toEqual({
        live: { broker_url: "mqtt://pit:1883" },
    });
    expect(formPatch(saved, { ...saved, client_id: "0x0011" })).toEqual({
        sero: { client_id: 17 },
    });
    expect(formPatch(saved, { ...saved, port: "abc" })).toBeNull();
});
