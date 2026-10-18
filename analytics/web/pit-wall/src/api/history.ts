import { queryOptions } from "@tanstack/react-query";
import type { SeriesColumns } from "../live/store";

/** Response of `GET /api/karts/{kart}/sessions/{session}/samples`. */
interface SamplesResponse {
    signals: Record<string, { t_us: number[]; v: number[] }>;
}

export interface HistoryParams {
    apiBaseUrl: string;
    kartId: string;
    sessionId: string;
    windowMin: number;
}

async function fetchHistory(
    { apiBaseUrl, kartId, sessionId, windowMin }: HistoryParams,
    signal: AbortSignal
): Promise<Map<number, SeriesColumns>> {
    const sinceUs = (Date.now() - windowMin * 60_000) * 1000;
    const url = `${apiBaseUrl}/karts/${encodeURIComponent(kartId)}/sessions/${encodeURIComponent(sessionId)}/samples?since_us=${sinceUs}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`history: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as SamplesResponse;

    const out = new Map<number, SeriesColumns>();
    for (const [id, cols] of Object.entries(body.signals)) {
        out.set(Number(id), { tMs: cols.t_us.map((t) => t / 1000), v: cols.v });
    }
    return out;
}

/**
 * Seed for the rolling charts: the last `windowMin` minutes of the session from the
 * database. Fetched once per session and window; live MQTT data takes over from there.
 */
export function historyQueryOptions(params: HistoryParams) {
    return queryOptions({
        queryKey: ["history", params.kartId, params.sessionId, params.windowMin],
        queryFn: ({ signal }) => fetchHistory(params, signal),
        staleTime: Infinity,
        gcTime: 0,
        retry: 2,
        refetchOnWindowFocus: false,
    });
}
