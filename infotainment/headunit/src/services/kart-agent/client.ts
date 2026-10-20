import {
    AgentStatus,
    AgentStatusSchema,
    ConfigPatch,
    ConfigReply,
    ConfigReplySchema,
} from "./schema";

/**
 * kart-agent runs next to the headunit as a systemd service and serves its status
 * and configuration on loopback. Used by the main process (src/main/kart-agent.ts),
 * which polls it and serves it to the renderer over IPC (CH.agent.*); the renderer
 * does not fetch it (the window has webSecurity on).
 */
export const KART_AGENT_URL = "http://127.0.0.1:7411";

const TIMEOUT_MS = 1500;

export class KartAgentError extends Error {}

async function request(path: string, init?: RequestInit): Promise<unknown> {
    let res: Response;
    try {
        res = await fetch(`${KART_AGENT_URL}${path}`, {
            ...init,
            signal: AbortSignal.timeout?.(TIMEOUT_MS),
        });
    } catch {
        throw new KartAgentError(`kart-agent is not reachable at ${KART_AGENT_URL}`);
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
        const message = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
        throw new KartAgentError(message);
    }
    return body;
}

export async function getStatus(): Promise<AgentStatus> {
    return AgentStatusSchema.parse(await request("/v1/status"));
}

export async function getConfig(): Promise<ConfigReply> {
    return ConfigReplySchema.parse(await request("/v1/config"));
}

/** Changes the agent's configuration. Most changes restart its pipeline (`restart_required`). */
export async function putConfig(patch: ConfigPatch): Promise<ConfigReply> {
    return ConfigReplySchema.parse(
        await request("/v1/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
        })
    );
}
