import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { signal } from "../live/catalog";
import { onFrame } from "../live/frame";
import { laps } from "../live/laps";
import { telemetry } from "../live/store";
import { formatValue } from "../views/format";
import { binLines, NO_SPEED_COLOR, SPEED_COLORS, speedColor, trackRuns } from "../views/track";

const LAT = signal("gps.lat");
const LON = signal("gps.lon");
const SPEED = signal("gps.speed");

/** Without new data the trail stays as it is; nothing slides, so rarely recheck. */
const IDLE_REDRAW_MS = 1000;
/** Before the first fix: the whole of Europe. */
const INITIAL_VIEW: L.LatLngTuple = [48.0, 11.0];
const INITIAL_ZOOM = 4;
const FIT_MAX_ZOOM = 18;

interface Props {
    windowMs: number;
    tileUrl: string;
    tileAttribution: string;
}

/**
 * The kart's trail over the last `windowMs` (kart time) on a raster map, coloured by
 * GPS speed, with the latest fix as a marker and the lap timer's light barrier, if any. Leaflet draws on one canvas; the frame
 * loop rebuilds the lines only when the telemetry store changed.
 */
export function TrackMap({ windowMs, tileUrl, tileAttribution }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const renderer = L.canvas({ padding: 0.2 });
        const map = L.map(container, { renderer, zoomSnap: 0.5 }).setView(
            INITIAL_VIEW,
            INITIAL_ZOOM
        );
        L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);

        // A white casing under the coloured lines keeps the trail readable on any tile.
        const casing = L.polyline([], { color: "#ffffff", weight: 7, opacity: 0.9, renderer });
        const lines = [NO_SPEED_COLOR, ...SPEED_COLORS].map((color) =>
            L.polyline([], { color, weight: 4, lineCap: "round", lineJoin: "round", renderer })
        );
        const marker = L.circleMarker(INITIAL_VIEW, {
            radius: 8,
            color: "#ffffff",
            weight: 2,
            fillOpacity: 1,
            renderer,
        }).bindTooltip("", { direction: "top", offset: [0, -8] });
        // Where the light barrier stands, as its newest lap crossing reports it.
        const barrier = L.circleMarker(INITIAL_VIEW, {
            radius: 6,
            color: "#ffffff",
            weight: 2,
            fillColor: "#111827",
            fillOpacity: 1,
            renderer,
        }).bindTooltip("Light barrier (start/finish)", { direction: "top", offset: [0, -6] });
        casing.addTo(map);
        for (const l of lines) l.addTo(map);

        let fitted = false;
        let lastVersion = -1;
        let lastLapsVersion = -1;
        let lastDraw = 0;
        const stop = onFrame((frameTime) => {
            const version = telemetry.version;
            const lapsVersion = laps.version;
            const unchanged = version === lastVersion && lapsVersion === lastLapsVersion;
            if (unchanged && frameTime - lastDraw < IDLE_REDRAW_MS) return;
            lastVersion = version;
            lastLapsVersion = lapsVersion;
            lastDraw = frameTime;

            const line = laps.barrier();
            if (line) {
                barrier.setLatLng([line.lat, line.lon]);
                if (!map.hasLayer(barrier)) barrier.addTo(map);
            } else {
                barrier.remove();
            }

            const lat = telemetry.points(LAT.id);
            const newest = lat.findLast((p) => !isNaN(p.y))?.x;
            const runs =
                newest === undefined
                    ? []
                    : trackRuns(
                          lat,
                          telemetry.points(LON.id),
                          telemetry.points(SPEED.id),
                          newest - windowMs
                      );
            casing.setLatLngs(runs.map((r) => r.map((p): L.LatLngTuple => [p.lat, p.lon])));
            binLines(runs).forEach((bin, i) => lines[i]!.setLatLngs(bin));

            const last = runs.at(-1)?.at(-1);
            if (!last) {
                marker.remove();
                fitted = false;
                return;
            }
            const pos: L.LatLngTuple = [last.lat, last.lon];
            marker
                .setLatLng(pos)
                .setStyle({ fillColor: speedColor(last.speed) })
                .setTooltipContent(
                    last.speed === null ? "No speed" : `${formatValue(SPEED, last.speed)} km/h`
                );
            if (!map.hasLayer(marker)) marker.addTo(map);
            if (!fitted) {
                map.fitBounds(casing.getBounds().pad(0.1), { maxZoom: FIT_MAX_ZOOM });
                fitted = true;
            } else if (!map.getBounds().pad(-0.1).contains(pos)) {
                map.panTo(pos);
            }
        });

        // The map measures its container once; follow layout changes.
        const resize = new ResizeObserver(() => map.invalidateSize());
        resize.observe(container);

        return () => {
            stop();
            resize.disconnect();
            map.remove();
        };
    }, [windowMs, tileUrl, tileAttribution]);

    return (
        <div
            ref={containerRef}
            className="rounded-box z-0 h-[60vh] min-h-72 w-full"
            role="region"
            aria-label="Map of the kart's GPS trail"
        />
    );
}
