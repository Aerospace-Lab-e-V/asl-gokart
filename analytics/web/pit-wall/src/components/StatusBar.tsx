import type { ReactNode } from "react";
import type { BrokerState } from "../live/connection";
import { useKartStatus, useLive, useTick } from "../live/hooks";
import { telemetry } from "../live/store";
import { formatAge } from "../views/format";

const BROKER_LABEL: Record<BrokerState, string> = {
    connecting: "Connecting",
    connected: "Connected",
    reconnecting: "Reconnecting",
    offline: "Disconnected",
};

/**
 * Link and session facts for the kart on screen. Information only: the crew judges
 * what it means, nothing here raises an alert.
 */
export function StatusBar({ kartId, historyError }: { kartId: string; historyError: boolean }) {
    const now = useTick();
    const { broker } = useLive();
    const status = useKartStatus(kartId);
    const age = telemetry.newestTMs === null ? null : now - telemetry.newestTMs;
    // The session whose data is on screen; the retained status may name another sender's.
    const session = telemetry.sessionId ?? status?.sessionId ?? null;

    return (
        <dl className="text-base-content/70 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Item term="Broker">
                <span
                    className={`status ${broker === "connected" ? "status-success" : "status-neutral"}`}
                    aria-hidden="true"
                />
                {BROKER_LABEL[broker]}
            </Item>
            <Item term="Kart">
                <span
                    className={`status ${status?.online ? "status-success" : "status-neutral"}`}
                    aria-hidden="true"
                />
                {status ? (status.online ? "Online" : "Offline") : "Unknown"}
            </Item>
            <Item term="Session">
                <span className="font-mono" title={session ?? undefined}>
                    {session ? session.slice(-8) : "—"}
                </span>
            </Item>
            <Item term="Data age">
                <span className="tabular-nums">{formatAge(age)}</span>
            </Item>
            <Item term="Lost batches">
                <span className="tabular-nums">{telemetry.lostBatches}</span>
            </Item>
            {telemetry.otherSessionBatches > 0 && (
                <Item term="Other sender">
                    <span className="tabular-nums">
                        {telemetry.otherSessionBatches} batches of another session ignored
                    </span>
                </Item>
            )}
            {historyError && <Item term="History">unavailable, live only</Item>}
        </dl>
    );
}

function Item({ term, children }: { term: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-1.5">
            <dt className="text-base-content/50">{term}</dt>
            <dd className="text-base-content flex items-center gap-1.5">{children}</dd>
        </div>
    );
}
