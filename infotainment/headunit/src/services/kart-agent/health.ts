import { AgentStatus } from "./schema";

/**
 * Turns kart-agent's status into what the headunit shows: one state per subsystem,
 * worded for someone glancing at the screen. The raw counters stay in the agent's log.
 */

export type Tone = "ok" | "warn" | "fault" | "off";

export type Line = {
    tone: Tone;
    /** The state in one or two words, e.g. "Connected". */
    state: string;
    /** One supporting value, or the reason when something is wrong. */
    detail?: string;
};

export type Ecu = { name: string; online: boolean; note: string };

export function recording(status: AgentStatus): Line {
    const log = status.log;
    if (log.active_segment) {
        return { tone: "ok", state: "Recording", detail: `${(log.fs_free_bytes / 1e9).toFixed(1)} GB free` };
    }
    if (log.last_error) return { tone: "fault", state: "Not recording", detail: "Disk write error" };
    return { tone: "warn", state: "Waiting for data" };
}

/** "mqtt://10.0.0.1:1883/x" → "10.0.0.1:1883" (URL does not parse hosts of mqtt:// in this Chromium). */
const brokerHost = (url: string) => url.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");

export function uplink(status: AgentStatus): Line {
    const live = status.live;
    if (!live.enabled) return { tone: "off", state: "Off" };
    if (!live.configured) return { tone: "warn", state: "No broker set" };
    const detail = brokerHost(live.broker_url);
    return live.connected
        ? { tone: "ok", state: "Connected", detail }
        : { tone: "warn", state: "Connecting", detail };
}

export function ecus(status: AgentStatus): Ecu[] {
    return status.sero.services.map((s) => {
        const subscribed = s.events.every((e) => e.ack === 0);
        const name = s.name.charAt(0).toUpperCase() + s.name.slice(1);
        if (!s.found) return { name, online: false, note: "Not found" };
        return { name, online: subscribed, note: subscribed ? "Online" : "Subscribing" };
    });
}

export function carNetwork(status: AgentStatus): Line {
    const sero = status.sero;
    switch (sero.state) {
        case "running": {
            const list = ecus(status);
            const online = list.filter((e) => e.online).length;
            const all = list.length > 0 && online === list.length;
            return { tone: all ? "ok" : "warn", state: `${online} / ${list.length} ECUs` };
        }
        case "waiting_for_interface":
            return { tone: "warn", state: "No network", detail: `${sero.interface} is down` };
        case "error":
            return { tone: "fault", state: "Error", detail: sero.error ?? undefined };
        default:
            return { tone: "warn", state: sero.state.charAt(0).toUpperCase() + sero.state.slice(1) };
    }
}

/**
 * The single state the driver sees in the header: red when nothing is being
 * recorded, otherwise the uplink's state. "unknown" until the first poll answers.
 */
export function overall(status: AgentStatus | null, error: string | null): Tone | "unknown" {
    if (error) return "fault";
    if (!status) return "unknown";
    if (recording(status).tone !== "ok") return "fault";
    return uplink(status).tone;
}
