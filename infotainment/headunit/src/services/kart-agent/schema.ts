import { z } from "zod";

/**
 * Responses of kart-agent's local API (analytics/crates/kart-agent/src/api.rs).
 * Only the fields the headunit uses; unknown fields are dropped, so a newer agent
 * keeps working. Contract test: src/tests/unit/kart-agent-client.test.ts.
 */

const EventStatusSchema = z.object({
    id: z.number(),
    ack: z.number().nullable(),
    last_ack_us: z.number().nullable(),
    last_rx_us: z.number().nullable(),
    rx: z.number(),
    decode_errors: z.number(),
});

const ServiceStatusSchema = z.object({
    id: z.number(),
    name: z.string(),
    found: z.boolean(),
    provider: z.string().nullable(),
    events: z.array(EventStatusSchema),
});

export const AgentStatusSchema = z.object({
    agent: z.object({
        version: z.string(),
        uptime_s: z.number(),
        runs: z.number(),
        restart_pending: z.boolean(),
    }),
    session: z.object({
        id: z.string(),
        next_seq: z.number(),
    }),
    clock: z.object({
        synced: z.boolean(),
    }),
    sero: z.object({
        state: z.string(),
        error: z.string().nullable(),
        interface: z.string(),
        address: z.string().nullable(),
        services: z.array(ServiceStatusSchema),
        counters: z.record(z.string(), z.number()),
    }),
    live: z.object({
        enabled: z.boolean(),
        configured: z.boolean(),
        broker_url: z.string(),
        connected: z.boolean(),
        published: z.number(),
        dropped: z.number(),
    }),
    log: z.object({
        active_segment: z.string().nullable(),
        total_bytes: z.number(),
        segments: z.number(),
        fs_free_bytes: z.number(),
        write_errors: z.number(),
        last_error: z.string().nullable(),
    }),
});

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** The settings the Telemetry page edits. */
export const AgentConfigSchema = z.object({
    kart_id: z.string(),
    live: z.object({
        enabled: z.boolean(),
        broker_url: z.string(),
        batch_ms: z.number(),
    }),
    sero: z.object({
        interface: z.string(),
        client_id: z.number(),
        port: z.number(),
    }),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ConfigReplySchema = z.object({
    effective: AgentConfigSchema,
    restart_required: z.boolean(),
});

export type ConfigReply = z.infer<typeof ConfigReplySchema>;

/** A JSON merge patch (RFC 7396): only the keys to change; `null` removes an override. */
export type ConfigPatch = {
    kart_id?: string | null;
    live?: Partial<{ enabled: boolean | null; broker_url: string | null; batch_ms: number | null }>;
    sero?: Partial<{ interface: string | null; client_id: number | null; port: number | null }>;
};
