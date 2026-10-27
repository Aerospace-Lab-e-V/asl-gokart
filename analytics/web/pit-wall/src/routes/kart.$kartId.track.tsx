import { createFileRoute } from "@tanstack/react-router";
import { TrackMap } from "../components/TrackMap";
import { signal } from "../live/catalog";
import { useTick } from "../live/hooks";
import { telemetry } from "../live/store";
import { binLabel, NO_SPEED_COLOR, SPEED_COLORS } from "../views/track";
import { useWindowMin } from "../views/useWindowMin";

export const Route = createFileRoute("/kart/$kartId/track")({
    component: TrackView,
});

function TrackView() {
    const windowMs = useWindowMin() * 60_000;
    const { config } = Route.useRouteContext();
    return (
        <div className="card bg-base-200">
            <div className="card-body gap-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-medium">Track map</h2>
                    <SpeedLegend />
                </div>
                <div className="relative">
                    <TrackMap
                        windowMs={windowMs}
                        tileUrl={config.tileUrl}
                        tileAttribution={config.tileAttribution}
                    />
                    <NoFix />
                </div>
            </div>
        </div>
    );
}

/** Swatches wear the trail's white casing, so the darkest step reads on the dark theme too. */
function SpeedLegend() {
    return (
        <ul
            aria-label="Trail colour: GPS speed in km/h"
            className="text-base-content/70 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        >
            {SPEED_COLORS.map((color, bin) => (
                <li key={color} className="flex items-center gap-1">
                    <span
                        className="h-1.5 w-4 rounded-full ring-1 ring-white"
                        style={{ background: color }}
                    />
                    {binLabel(bin)}
                </li>
            ))}
            <li className="flex items-center gap-1">
                <span
                    className="h-1.5 w-4 rounded-full ring-1 ring-white"
                    style={{ background: NO_SPEED_COLOR }}
                />
                no speed
            </li>
            <li>km/h</li>
        </ul>
    );
}

const LAT = signal("gps.lat");
const FIX = signal("gps.fix");
const SATELLITES = signal("gps.satellites");

/** Over the map until the first position arrives. */
function NoFix() {
    useTick();
    if (telemetry.latest(LAT.id)) return null;
    const fix = telemetry.latest(FIX.id);
    const satellites = telemetry.latest(SATELLITES.id)?.value;
    return (
        <div className="bg-base-200/80 rounded-box pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center text-center">
            <p className="text-base-content/70">
                {fix
                    ? `Waiting for a GPS fix (${satellites ?? 0} satellites)`
                    : "No GPS data from this kart yet"}
            </p>
        </div>
    );
}
