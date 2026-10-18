/**
 * Runtime configuration, read from /config.json at startup so one build runs in every
 * environment. All fields are optional; the defaults use the same origin as the page
 * (Vite dev proxy or Caddy in the container).
 */
export interface PitWallConfig {
    /** MQTT over WebSocket, e.g. `wss://pit.example.org/mqtt`. */
    mqttUrl: string;
    /** Read-only broker user (subscribe to kart/+/live and kart/+/status only). */
    mqttUsername?: string;
    mqttPassword?: string;
    /** Base URL of pit-api. */
    apiBaseUrl: string;
}

function defaults(): PitWallConfig {
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    return {
        mqttUrl: `${wsProtocol}//${location.host}/mqtt`,
        apiBaseUrl: "/api",
    };
}

export async function loadConfig(): Promise<PitWallConfig> {
    try {
        const res = await fetch("/config.json", { cache: "no-store" });
        if (!res.ok) return defaults();
        const overrides = (await res.json()) as Partial<PitWallConfig>;
        return { ...defaults(), ...overrides };
    } catch {
        return defaults();
    }
}
