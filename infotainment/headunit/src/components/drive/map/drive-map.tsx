import React, { useEffect, useRef, useState } from "react";
import { MapMinus, MapPinOff, Satellite } from "lucide-react";
import { MAP_ATTRIBUTION, MAP_PIVOT_Y, MAP_TILE_URL } from "@/data/map-config";
import { useIsDark } from "@/hooks/use-is-dark";
import { emaStep } from "@/lib/utils/smoothing";
import { cn } from "@/lib/utils";
import { readSignal, useSignals } from "@/stores/signals";
import { KartArrow, MapLoader, MapPlaceholder } from "./map-overlays";
import { TileLayer, type TileStatus } from "./tile-layer";
import { angleDelta, coverRadius, zoomForSpeed } from "./tile-math";
import { useGpsFix } from "./use-gps-fix";

/** Longest a new GPS position is eased in over; epochs come every 200 ms at 5 Hz. */
const POSITION_EASE_MAX_MS = 400;
const HEADING_TAU_MS = 300;
/** Slow, so the zoom does not pump with every throttle change. */
const ZOOM_TAU_MS = 2000;

const pivotTop = `${MAP_PIVOT_Y * 100}%`;

interface LatLon {
    lat: number;
    lon: number;
}

/**
 * Heading-up map of where the kart is, edges faded into the page, no frame. Monochrome tiles in the theme's
 * shade from the offline map packs; the zoom follows the speed. Placeholders say why there is no map
 * (no GPS, or no pack for this area).
 */
export const DriveMap = ({ className }: { className?: string }) => {
    const fix = useGpsFix();
    const url = useIsDark() ? MAP_TILE_URL.dark : MAP_TILE_URL.light;
    const [status, setStatus] = useState<TileStatus>("loading");
    const panelRef = useRef<HTMLDivElement>(null);
    const tilesRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<TileLayer | null>(null);
    const urlRef = useRef(url);
    const hasPosition = fix.kind === "ok" || fix.kind === "lost";

    useEffect(() => {
        urlRef.current = url;
        layerRef.current?.setUrl(url);
    }, [url]);

    // Set up once per position: the frame loop reads the signal store directly, nothing here re-renders per sample.
    useEffect(() => {
        const panel = panelRef.current;
        const root = tilesRef.current;
        if (!hasPosition || !panel || !root) return;
        const layer = new TileLayer(root, urlRef.current, setStatus);
        layerRef.current = layer;

        let width = panel.clientWidth;
        let height = panel.clientHeight;
        const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(([entry]) => {
            width = entry.contentRect.width;
            height = entry.contentRect.height;
        });
        resize?.observe(panel);

        let from: LatLon | null = null;
        let to: LatLon | null = null;
        let easeStart = 0;
        let easeMs = 0;
        const eased = (now: number): LatLon | null => {
            if (!from || !to) return null;
            const f = easeMs > 0 ? Math.min(1, (now - easeStart) / easeMs) : 1;
            return { lat: from.lat + (to.lat - from.lat) * f, lon: from.lon + (to.lon - from.lon) * f };
        };
        let lastFix = "";
        let lastFixAt = 0;
        let heading: number | null = null;
        let zoom: number | null = null;
        let lastFrame: number | null = null;
        let lastDrawn = "";
        let raf = 0;

        const frame = (now: number) => {
            raf = requestAnimationFrame(frame);
            const signals = useSignals.getState();
            const lat = signals["gps.lat"];
            const lon = signals["gps.lon"];
            // A new position eases in over the time since the last one, from wherever the last ease got to (so a
            // fix per frame on a slow Pi still moves the map); a stale one is held.
            if (lat && lon && !lat.stale && !lon.stale) {
                const at = `${lat.value},${lon.value}`;
                if (at !== lastFix) {
                    lastFix = at;
                    from = eased(now) ?? { lat: lat.value, lon: lon.value };
                    to = { lat: lat.value, lon: lon.value };
                    easeMs = lastFixAt ? Math.min(POSITION_EASE_MAX_MS, now - lastFixAt) : 0;
                    easeStart = now;
                    lastFixAt = now;
                }
            }
            const shown = eased(now);
            if (!shown) return;

            const dt = lastFrame === null ? 0 : now - lastFrame;
            lastFrame = now;
            const target = zoomForSpeed(readSignal("gps.speed"));
            zoom = zoom === null ? target : emaStep(zoom, target, dt, ZOOM_TAU_MS);
            // Held when stale: the receiver only sends a heading above 3 km/h.
            const course = signals["gps.heading"]?.value;
            if (course !== undefined) {
                heading = heading === null ? course : heading + angleDelta(heading, course) * (1 - Math.exp(-dt / HEADING_TAU_MS));
            }

            const drawn = `${shown.lat.toFixed(7)},${shown.lon.toFixed(7)},${zoom.toFixed(3)},${(heading ?? 0).toFixed(1)},${width},${height}`;
            if (drawn === lastDrawn) return;
            lastDrawn = drawn;
            const pivot = { x: width / 2, y: height * MAP_PIVOT_Y };
            layer.render({ ...shown, zoom, heading: heading ?? 0, pivot, radius: coverRadius(width, height, pivot) });
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            resize?.disconnect();
            layer.destroy();
            layerRef.current = null;
            setStatus("loading");
        };
    }, [hasPosition]);

    const showMap = hasPosition && status === "ready";

    return (
        <div ref={panelRef} className={cn("relative overflow-hidden", className)} data-testid="drive-map">
            <div ref={tilesRef} className={cn("absolute inset-0", !showMap && "invisible")} />

            {showMap && (
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: pivotTop }}>
                    <KartArrow dim={fix.kind === "lost"} />
                </div>
            )}

            {/* Edges fade into the page instead of a frame; plain gradients, a mask would cost the Pi a layer. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-background to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent" />

            {fix.kind === "lost" && showMap && (
                <p className="absolute inset-x-0 text-center text-lg text-muted-foreground" style={{ top: `calc(${pivotTop} + 2.5rem)` }}>
                    GPS lost
                </p>
            )}

            {hasPosition && status === "loading" && (
                // Centred on the arrow's spot: the ring box is 10rem, so up by half of it.
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-20" style={{ top: pivotTop }}>
                    <MapLoader />
                </div>
            )}

            <div className="absolute inset-0 flex items-center justify-center">
                {fix.kind === "unavailable" && <MapPlaceholder icon={MapPinOff} title="GPS unavailable" />}
                {fix.kind === "searching" && (
                    <MapPlaceholder icon={Satellite} title="Waiting for GPS fix" detail={`${fix.satellites} satellites`} />
                )}
                {hasPosition && status === "missing" && (
                    <MapPlaceholder icon={MapMinus} title="No offline map for this area" detail="Download it in Settings → Offline maps" />
                )}
            </div>

            {/* Required by the map data's licence (ODbL); the one label smaller than text-lg. */}
            {showMap && <p className="absolute bottom-1 right-2 text-xs text-muted-foreground/60">{MAP_ATTRIBUTION}</p>}
        </div>
    );
};
