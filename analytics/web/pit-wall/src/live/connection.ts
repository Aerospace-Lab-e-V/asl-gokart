import mqtt, { type MqttClient } from "mqtt";
import type { PitWallConfig } from "./config";
import { decodeBatch, decodeStatus, type KartStatus } from "./decode";
import { telemetry } from "./store";

export type BrokerState = "connecting" | "connected" | "reconnecting" | "offline";

export interface LiveSnapshot {
    broker: BrokerState;
    /** Latest retained status per kart id. */
    karts: ReadonlyMap<string, KartStatus>;
}

const STATUS_TOPIC = "kart/+/status";
const liveTopic = (kartId: string) => `kart/${kartId}/live`;

/**
 * The single MQTT-over-WebSocket connection. Read-only: it subscribes to every kart's
 * status and to the live topic of the kart on screen, and never publishes.
 * Live batches go straight into the telemetry store, bypassing React.
 */
class LiveConnection {
    private client: MqttClient | null = null;
    private watched: string | null = null;
    private snapshot: LiveSnapshot = { broker: "offline", karts: new Map() };
    private readonly listeners = new Set<() => void>();

    connect(config: PitWallConfig): void {
        if (this.client) return;
        this.update({ broker: "connecting" });
        const client = mqtt.connect(config.mqttUrl, {
            protocolVersion: 5,
            clientId: `pit-wall-${crypto.randomUUID().slice(0, 8)}`,
            username: config.mqttUsername,
            password: config.mqttPassword,
            clean: true,
            reconnectPeriod: 1000,
            connectTimeout: 5000,
            keepalive: 10,
        });
        client.on("connect", () => this.update({ broker: "connected" }));
        client.on("reconnect", () => this.update({ broker: "reconnecting" }));
        client.on("offline", () => this.update({ broker: "offline" }));
        client.on("close", () => {
            if (this.snapshot.broker === "connected") this.update({ broker: "reconnecting" });
        });
        client.on("message", (topic, payload) => this.onMessage(topic, payload));
        // mqtt.js re-subscribes on reconnect.
        client.subscribe(STATUS_TOPIC, { qos: 1 });
        this.client = client;
        if (this.watched) client.subscribe(liveTopic(this.watched), { qos: 0 });
    }

    /** Switches the live subscription to `kartId` (null: no kart on screen). */
    watch(kartId: string | null): void {
        if (kartId === this.watched) return;
        if (this.watched) this.client?.unsubscribe(liveTopic(this.watched));
        this.watched = kartId;
        telemetry.reset(null);
        if (kartId) this.client?.subscribe(liveTopic(kartId), { qos: 0 });
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = (): LiveSnapshot => this.snapshot;

    private onMessage(topic: string, payload: Uint8Array): void {
        const [prefix, kartId, kind] = topic.split("/");
        if (prefix !== "kart" || !kartId) return;
        try {
            if (kind === "live") {
                if (kartId === this.watched) telemetry.ingest(decodeBatch(payload));
            } else if (kind === "status") {
                const karts = new Map(this.snapshot.karts);
                const status = decodeStatus(payload);
                if (status) karts.set(kartId, status);
                else karts.delete(kartId);
                this.update({ karts });
            }
        } catch (e) {
            console.warn(`pit-wall: cannot decode ${topic}`, e);
        }
    }

    private update(patch: Partial<LiveSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch };
        for (const l of this.listeners) l();
    }
}

export const live = new LiveConnection();
