import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { BatchSchema, SampleSchema, StatusSchema } from "../gen/telemetry_pb";
import { LapCrossingSchema, Verdict } from "../gen/timing_pb";
import { decodeBatch, decodeLapCrossing, decodeStatus } from "./decode";

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

    it("decodes a LapCrossing with the verdict name and optional fields", () => {
        const base = {
            crossingId: "0190a0e0-0000-7000-8000-000000000001",
            deviceId: "speedcamera-01",
            kartId: "kart-01",
            kartSessionId: "0190a0e0-0000-7000-8000-000000000000",
            tUs: 1_700_000_000_123_456n,
            speedKmh: 38.4,
            barrierLat: 48.1,
            barrierLon: 11.5,
            clockSynced: true,
        };
        const lapEnd = decodeLapCrossing(
            toBinary(
                LapCrossingSchema,
                create(LapCrossingSchema, {
                    ...base,
                    lapNumber: 3,
                    lapUs: 42_123_456n,
                    verdict: Verdict.ACCEPTED,
                    distanceM: 2.5,
                })
            )
        );
        expect(lapEnd).toMatchObject({
            tMs: 1_700_000_000_123.456,
            lapNumber: 3,
            lapMs: 42_123.456,
            verdict: "ACCEPTED",
            distanceM: 2.5,
        });

        const rejected = decodeLapCrossing(
            toBinary(
                LapCrossingSchema,
                create(LapCrossingSchema, { ...base, verdict: Verdict.REJECTED_SLOW })
            )
        );
        expect(rejected).toMatchObject({ lapMs: null, distanceM: null, verdict: "REJECTED_SLOW" });
    });
});
