import { queryOptions } from "@tanstack/react-query";
import type { LapCrossing, VerdictName } from "../live/decode";

/** Response of `GET /api/karts/{kart}/sessions/{session}/laps`. */
interface LapsResponse {
    crossings: {
        crossing_id: string;
        device_id: string;
        time: number; // Unix µs
        lap_number: number;
        lap_us: number | null;
        speed_kmh: number;
        verdict: VerdictName;
        distance_m: number | null;
        barrier_lat: number;
        barrier_lon: number;
        clock_synced: boolean;
    }[];
}

export interface LapsParams {
    apiBaseUrl: string;
    kartId: string;
    sessionId: string;
}

async function fetchLaps(
    { apiBaseUrl, kartId, sessionId }: LapsParams,
    signal: AbortSignal
): Promise<LapCrossing[]> {
    const url = `${apiBaseUrl}/karts/${encodeURIComponent(kartId)}/sessions/${encodeURIComponent(sessionId)}/laps`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`laps: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as LapsResponse;
    return body.crossings.map((c) => ({
        crossingId: c.crossing_id,
        deviceId: c.device_id,
        kartSessionId: sessionId,
        tMs: c.time / 1000,
        lapNumber: c.lap_number,
        lapMs: c.lap_us === null ? null : c.lap_us / 1000,
        speedKmh: c.speed_kmh,
        verdict: c.verdict,
        distanceM: c.distance_m,
        barrierLat: c.barrier_lat,
        barrierLon: c.barrier_lon,
        clockSynced: c.clock_synced,
    }));
}

/**
 * Seed for the lap list: every crossing of the session so far. Fetched once per session;
 * live crossings from MQTT append from there.
 */
export function lapsQueryOptions(params: LapsParams) {
    return queryOptions({
        queryKey: ["laps", params.kartId, params.sessionId],
        queryFn: ({ signal }) => fetchLaps(params, signal),
        staleTime: Infinity,
        gcTime: 0,
        retry: 2,
        refetchOnWindowFocus: false,
    });
}
