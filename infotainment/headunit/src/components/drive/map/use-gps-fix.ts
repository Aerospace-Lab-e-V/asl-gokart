import { useEffect, useState } from "react";
import { GPS_HOLD_MS } from "@/data/map-config";
import type { Sample } from "@/domain/signals";
import { useSample } from "@/stores/signals";

/**
 * What the map can show, from kart-agent's GPS signals:
 * - `unavailable`: nothing from the receiver (agent not running, receiver unplugged)
 * - `searching`: the receiver reports satellites but has no position yet
 * - `ok`: a fresh position
 * - `lost`: the position went stale within the last GPS_HOLD_MS; the map holds it, dimmed
 */
export type GpsFix =
    | { kind: "unavailable" }
    | { kind: "searching"; satellites: number }
    | { kind: "ok" }
    | { kind: "lost" };

export function useGpsFix(): GpsFix {
    const lat = useSample("gps.lat");
    const satellites = useSample("gps.satellites");
    // The stale sample whose hold ran out. Timed from when the renderer saw it go stale, not from its ts: main only
    // forwards changes, so ts is the last change, which can be long ago for a kart standing still.
    const [expired, setExpired] = useState<Sample | null>(null);

    useEffect(() => {
        if (!lat?.stale) return;
        const id = setTimeout(() => setExpired(lat), GPS_HOLD_MS);
        return () => clearTimeout(id);
    }, [lat]);

    if (lat && !lat.stale) return { kind: "ok" };
    if (lat && lat !== expired) return { kind: "lost" };
    if (satellites && !satellites.stale) return { kind: "searching", satellites: satellites.value };
    return { kind: "unavailable" };
}
