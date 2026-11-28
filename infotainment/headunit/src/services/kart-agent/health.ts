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
    const host = brokerHost(live.broker_url);
    if (live.connected) return { tone: "ok", state: "Connected", detail: host };
    if (live.error === "not enrolled") return { tone: "warn", state: "Not enrolled", detail: "Enroll below" };
    return { tone: "warn", state: "Connecting", detail: live.error ?? host };
}

const DAY_S = 86_400;

const formatDate = (unixS: number) =>
    new Date(unixS * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * The kart's identity for the uplink (analytics ADR-0004): a certificate and broker login from
 * enrollment. `null` for agents without enrollment.
 */
export function identity(status: AgentStatus, nowS = Date.now() / 1000): Line | null {
    const e = status.enrollment;
    if (!e) return null;
    if (e.state === "pending") {
        return { tone: "warn", state: "Waiting for approval", detail: e.error ?? undefined };
    }
    if (e.state === "enrolled" && e.device_id) {
        const left = e.not_after_s !== null ? Math.floor((e.not_after_s - nowS) / DAY_S) : null;
        if (left !== null && left < 0) return { tone: "fault", state: "Expired", detail: `${e.device_id} · enroll again` };
        if (left !== null && left < 30) {
            return { tone: "warn", state: "Expires soon", detail: `${e.device_id} · in ${left} days, enroll again` };
        }
        const until = e.not_after_s !== null ? ` · until ${formatDate(e.not_after_s)}` : "";
        return { tone: "ok", state: "Enrolled", detail: `${e.device_id}${until}` };
    }
    // Only a wss:// uplink needs the certificate; mqtt:// in the lab works without.
    const needed = status.live.broker_url.startsWith("wss://");
    return { tone: needed ? "warn" : "off", state: "Not enrolled", detail: e.error ?? undefined };
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

const FIX_NAMES: Record<number, string> = { 2: "2D fix", 3: "3D fix", 4: "3D fix" };

/** `null` for an agent without GPS support. */
export function gps(status: AgentStatus): Line | null {
    const g = status.gps;
    if (!g) return null;
    const satellites = `${g.satellites} satellite${g.satellites === 1 ? "" : "s"}`;
    switch (g.state) {
        case "disabled":
            return { tone: "off", state: "Off" };
        case "waiting_for_device":
            return { tone: "warn", state: "Not connected", detail: "Plug in the USB receiver" };
        case "error":
            return { tone: "warn", state: "Error", detail: g.error ?? undefined };
        case "configuring":
        case "running": {
            const name = FIX_NAMES[g.fix];
            if (!name) return { tone: "warn", state: "No fix", detail: satellites };
            const hdop = g.hdop !== null ? ` · HDOP ${g.hdop.toFixed(1)}` : "";
            return { tone: "ok", state: name, detail: satellites + hdop };
        }
        default:
            return { tone: "warn", state: g.state.charAt(0).toUpperCase() + g.state.slice(1) };
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
