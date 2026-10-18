import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { BatchSchema, SampleSchema, StatusSchema } from "../gen/telemetry_pb";
import { decodeBatch, decodeStatus } from "./decode";

describe("decode", () => {
    it("decodes a Batch and converts 64-bit fields to numbers", () => {
        const payload = toBinary(
            BatchSchema,
            create(BatchSchema, {
                kartId: "kart-01",
                sessionId: "0190a0e0-0000-7000-8000-000000000000",
                seq: 42n,
                samples: [
                    create(SampleSchema, {
                        signalId: 101,
                        tUs: 1_700_000_000_123_456n,
                        value: 48.2,
                    }),
                ],
            })
        );
        expect(decodeBatch(payload)).toEqual({
            kartId: "kart-01",
            sessionId: "0190a0e0-0000-7000-8000-000000000000",
            seq: 42,
            samples: [{ signalId: 101, tMs: 1_700_000_000_123.456, value: 48.2 }],
        });
    });

    it("decodes a Status and treats an empty payload as cleared", () => {
        const payload = toBinary(
            StatusSchema,
            create(StatusSchema, {
                online: false,
                agentVersion: "kart-sim/0.1.0",
                schemaVersion: "0.1.0",
                sessionId: "s1",
            })
        );
        expect(decodeStatus(payload)).toEqual({
            online: false,
            agentVersion: "kart-sim/0.1.0",
            schemaVersion: "0.1.0",
            sessionId: "s1",
        });
        expect(decodeStatus(new Uint8Array())).toBeNull();
    });
});
