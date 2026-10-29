import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { counts, type LapCrossing, type VerdictName } from "../live/decode";
import { useTick } from "../live/hooks";
import { bestLap, formatLapTime, laps, type Lap } from "../live/laps";

export const Route = createFileRoute("/kart/$kartId/laps")({
    component: LapsView,
});

/** What the timing device decided, in words for the crew. */
const VERDICT_LABEL: Record<VerdictName, string> = {
    UNSPECIFIED: "Unknown",
    ACCEPTED: "Counted",
    ACCEPTED_UNVERIFIED: "Counted, position not checked",
    REJECTED_FAR: "Ignored, kart not at the line",
    REJECTED_SLOW: "Ignored, too slow for the kart",
    REJECTED_DUPLICATE: "Ignored, double trigger",
    REJECTED_KART_OFFLINE: "Ignored, kart offline",
    REJECTED_DIRECTION: "Ignored, wrong direction",
};

/** How many crossings the log lists, newest first. */
const LOG_LENGTH = 20;

/**
 * Lap times from the trackside light barrier: the running lap, last and best, every lap
 * of the session, and the crossings the barrier saw (including the ones it ignored).
 */
function LapsView() {
    const now = useTick();
    const all = laps.laps();
    const best = bestLap(all);
    const last = all.at(-1) ?? null;
    const running = laps.running();
    const newest = laps.crossings.at(-1);

    if (laps.crossings.length === 0) {
        return (
            <div className="card bg-base-200">
                <div className="card-body items-center text-center">
                    <h2 className="card-title">No laps yet</h2>
                    <p className="text-base-content/70">
                        Laps appear here when the speedcamera's lap timer reports crossings for this
                        kart's session.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 sm:gap-4">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <Stat title={running ? `Lap ${running.number}` : "Running lap"}>
                    {running ? formatLapTime(now - running.startMs, 1) : "—"}
                </Stat>
                <Stat title="Last lap" detail={last && best ? delta(last, best) : undefined}>
                    {last ? formatLapTime(last.ms) : "—"}
                </Stat>
                <Stat title="Best lap" detail={best ? `lap ${best.number}` : undefined}>
                    {best ? formatLapTime(best.ms) : "—"}
                </Stat>
                <Stat title="Laps">{all.length}</Stat>
            </div>
            {newest && !newest.clockSynced && (
                <p className="text-base-content/70 text-sm">
                    The timing device's clock is not synced: lap times are exact, but the running
                    lap clock and crossing times may be off.
                </p>
            )}

            <div className="card bg-base-200">
                <div className="card-body gap-3 p-3 sm:p-4">
                    <h2 className="text-sm font-medium">Laps</h2>
                    {all.length === 0 ? (
                        <p className="text-base-content/70">
                            The first lap ends at the next crossing.
                        </p>
                    ) : (
                        <LapTable laps={all} best={best} />
                    )}
                </div>
            </div>

            <div className="card bg-base-200">
                <div className="card-body gap-3 p-3 sm:p-4">
                    <h2 className="text-sm font-medium">Barrier crossings</h2>
                    <CrossingLog crossings={laps.crossings.slice(-LOG_LENGTH).reverse()} />
                </div>
            </div>
        </div>
    );
}

function Stat({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactNode;
}) {
    return (
        <div className="stats bg-base-200">
            <div className="stat px-4 py-3">
                <div className="stat-title">{title}</div>
                <div className="stat-value text-2xl tabular-nums sm:text-3xl">{children}</div>
                {detail && <div className="stat-desc tabular-nums">{detail}</div>}
            </div>
        </div>
    );
}

function delta(lap: Lap, best: Lap): string {
    if (lap.number === best.number) return "best lap";
    return `+${formatLapTime(lap.ms - best.ms)} to best`;
}

const clockTime = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

function LapTable({ laps: all, best }: { laps: Lap[]; best: Lap | null }) {
    return (
        <div className="overflow-x-auto">
            <table className="table-sm table tabular-nums">
                <thead>
                    <tr>
                        <th>Lap</th>
                        <th className="text-right">Time</th>
                        <th className="text-right">To best</th>
                        <th className="text-right">Speed at line</th>
                        <th className="text-right">Finished</th>
                    </tr>
                </thead>
                <tbody>
                    {[...all].reverse().map((lap) => (
                        <tr key={lap.number}>
                            <td>
                                {lap.number}
                                {lap.number === best?.number && (
                                    <span className="badge badge-ghost badge-sm ml-2">best</span>
                                )}
                            </td>
                            <td className="text-right font-medium">{formatLapTime(lap.ms)}</td>
                            <td className="text-base-content/70 text-right">
                                {best && lap.number !== best.number
                                    ? `+${formatLapTime(lap.ms - best.ms)}`
                                    : "—"}
                            </td>
                            <td className="text-right">{lap.speedAtEndKmh.toFixed(1)} km/h</td>
                            <td className="text-base-content/70 text-right">
                                {clockTime(lap.endMs)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CrossingLog({ crossings }: { crossings: LapCrossing[] }) {
    return (
        <ul className="flex flex-col text-sm">
            {crossings.map((c) => (
                <li
                    key={c.crossingId}
                    className={`border-base-300 flex flex-wrap gap-x-4 gap-y-0.5 border-b py-1.5 last:border-b-0 ${counts(c.verdict) ? "" : "text-base-content/60"}`}
                >
                    <span className="tabular-nums">{clockTime(c.tMs)}</span>
                    <span className="min-w-0 flex-1">{VERDICT_LABEL[c.verdict]}</span>
                    <span className="tabular-nums">{c.speedKmh.toFixed(1)} km/h</span>
                    <span className="w-24 text-right tabular-nums">
                        {c.distanceM === null ? "—" : `${c.distanceM.toFixed(0)} m from line`}
                    </span>
                </li>
            ))}
        </ul>
    );
}
