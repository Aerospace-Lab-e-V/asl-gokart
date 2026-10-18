import { fromBinary } from "@bufbuild/protobuf";
import { BatchSchema, StatusSchema } from "../gen/telemetry_pb";

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
