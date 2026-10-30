import log from "electron-log/main";
import { SIGNAL_NAMES, signalMeta, type SignalName } from "@/domain/signals";
import { KART_AGENT_URL } from "@/main/kart-agent-client";
import { markStale, publish } from "@/main/signal-hub";
import { StreamSamplesSchema } from "@/services/kart-agent/schema";

/*
 * kart-agent adapter: reads the agent's live stream (Server-Sent Events on /v1/stream, see
 * analytics/crates/kart-agent/src/stream.rs) and publishes the signals it owns into the signal hub. It owns
 * every signal no zone controller measures (no `ecu` in domain/signals.ts; today gps.*). The stream carries
 * the zone controllers' signals too, but those come from the Sero adapter, so no signal has two writers
 * (ADR-0002). Loopback only, so it does not wait for the car network.
 */

const STREAM_URL = `${KART_AGENT_URL}/v1/stream`;
const RETRY_MS = 1000;

const OWNED: ReadonlySet<string> = new Set(
    SIGNAL_NAMES.filter((name) => signalMeta(name).ecu === undefined)
);

export interface SseEvent {
    event: string;
    data: string;
}

/**
 * Splits the complete events off `buffer`; `rest` is the unfinished tail to prepend to the next chunk.
 * Events end with a blank line; lines starting with ":" are comments (the agent's keep-alives). The agent
 * (axum) writes "\n" line ends only.
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
    const blocks = buffer.split("\n\n");
    const rest = blocks.pop() ?? "";
    const events: SseEvent[] = [];
    for (const block of blocks) {
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
            if (line.startsWith(":")) continue;
            const colon = line.indexOf(":");
            const field = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
            if (field === "event") event = value;
            else if (field === "data") data.push(value);
        }
        if (data.length) events.push({ event, data: data.join("\n") });
    }
    return { events, rest };
}

/** Publishes the owned samples of one event. Event types this headunit does not know yet are ignored. */
export function handleEvent({ event, data }: SseEvent): void {
    if (event !== "samples") return;
    let parsed;
    try {
        parsed = StreamSamplesSchema.safeParse(JSON.parse(data));
    } catch {
        parsed = null;
    }
    if (!parsed?.success) {
        log.warn("[agent-stream] Skipped a malformed samples event:", data.slice(0, 200));
        return;
    }
    // The agent's receive time, so values from the snapshot that are already old go stale right away.
    const ts = parsed.data.t_us / 1000;
    for (const [name, value] of Object.entries(parsed.data.samples)) {
        if (OWNED.has(name)) publish(name as SignalName, value, ts);
    }
}

function markOwnedStale(): void {
    OWNED.forEach((name) => markStale(name as SignalName));
}

let controller: AbortController | null = null;
let connected = false;

function setConnected(now: boolean, reason?: string): void {
    if (now === connected) return;
    connected = now;
    if (now) log.info("[agent-stream] Connected to kart-agent");
    else
        log.warn(
            `[agent-stream] Lost kart-agent (${reason ?? "stream ended"}), reconnecting every ${RETRY_MS} ms`
        );
}

/** Reads one connection until the agent ends it (e.g. a configuration restart); rejects on errors. */
async function readStream(signal: AbortSignal): Promise<void> {
    const res = await fetch(STREAM_URL, { signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    setConnected(true);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        const { events, rest } = parseSse(buffer + value);
        buffer = rest;
        events.forEach(handleEvent);
    }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });
}

export function startAgentStream(): void {
    if (controller) return;
    const c = new AbortController();
    controller = c;
    log.info(`[agent-stream] Reading ${STREAM_URL}`);
    void (async () => {
        while (!c.signal.aborted) {
            let reason: string | undefined;
            try {
                await readStream(c.signal);
            } catch (err) {
                reason = err instanceof Error ? err.message : String(err);
            }
            if (c.signal.aborted) return;
            markOwnedStale();
            setConnected(false, reason);
            await sleep(RETRY_MS, c.signal);
        }
    })();
}

export function stopAgentStream(): void {
    controller?.abort();
    controller = null;
    connected = false;
    markOwnedStale();
}
