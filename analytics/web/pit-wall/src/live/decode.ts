import { fromBinary } from "@bufbuild/protobuf";
import { BatchSchema, StatusSchema } from "../gen/telemetry_pb";
import { LapCrossingSchema, Verdict } from "../gen/timing_pb";

export interface LiveSample {
    signalId: number;
    /** Kart time in milliseconds since the Unix epoch (from `t_us`). */
    tMs: number;
    value: number;
}

export interface LiveBatch {
    kartId: string;
    sessionId: string;
    seq: number;
    samples: LiveSample[];
}

export interface KartStatus {
    online: boolean;
    agentVersion: string;
    schemaVersion: string;
    sessionId: string;
}

// 64-bit fields decode as bigint. Unix microseconds (~1.7e15) and batch counters stay
// far below 2^53, so converting to number is exact.

export function decodeBatch(payload: Uint8Array): LiveBatch {
    const b = fromBinary(BatchSchema, payload);
    return {
        kartId: b.kartId,
        sessionId: b.sessionId,
        seq: Number(b.seq),
        samples: b.samples.map((s) => ({
            signalId: s.signalId,
            tMs: Number(s.tUs) / 1000,
            value: s.value,
        })),
    };
}

/** Returns null for an empty payload (a cleared retained message). */
export function decodeStatus(payload: Uint8Array): KartStatus | null {
    if (payload.length === 0) return null;
    const s = fromBinary(StatusSchema, payload);
    return {
        online: s.online,
        agentVersion: s.agentVersion,
        schemaVersion: s.schemaVersion,
        sessionId: s.sessionId,
    };
}

/** Verdict name as ingest stores it: the enum name without its `VERDICT_` prefix. */
export type VerdictName = keyof typeof Verdict;

/** One crossing of a trackside timing device (`kart/{id}/laps`), counted or not. */
export interface LapCrossing {
    crossingId: string;
    deviceId: string;
    /** The kart's telemetry session at the crossing; "" when the device did not know it. */
    kartSessionId: string;
    /** First beam break, device time in ms since the Unix epoch. */
    tMs: number;
    /** Lap that starts at this crossing, 0 if none. */
    lapNumber: number;
    /** Duration of the lap that ends here (barrier-precise), null if none ends. */
    lapMs: number | null;
    speedKmh: number;
    verdict: VerdictName;
    distanceM: number | null;
    barrierLat: number;
    barrierLon: number;
    clockSynced: boolean;
}

export function counts(verdict: VerdictName): boolean {
    return verdict === "ACCEPTED" || verdict === "ACCEPTED_UNVERIFIED";
}

export function decodeLapCrossing(payload: Uint8Array): LapCrossing {
    const c = fromBinary(LapCrossingSchema, payload);
    return {
        crossingId: c.crossingId,
        deviceId: c.deviceId,
        kartSessionId: c.kartSessionId,
        tMs: Number(c.tUs) / 1000,
        lapNumber: c.lapNumber,
        lapMs: c.lapUs === undefined ? null : Number(c.lapUs) / 1000,
        speedKmh: c.speedKmh,
        verdict: (Verdict[c.verdict] ?? "UNSPECIFIED") as VerdictName,
        distanceM: c.distanceM ?? null,
        barrierLat: c.barrierLat,
        barrierLon: c.barrierLon,
        clockSynced: c.clockSynced,
    };
}
