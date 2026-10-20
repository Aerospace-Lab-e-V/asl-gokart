import { useEffect, useState } from "react";
import { EcuStatusMap } from "@/data/ecu/ecu-types";
import { firmware } from "@/services/firmware";
import log from "@/lib/logger";

/** Live online/offline status of the zone controllers; null until the first snapshot arrives. */
export function useEcuStatus(): EcuStatusMap | null {
    const [status, setStatus] = useState<EcuStatusMap | null>(null);

    useEffect(() => {
        let pushed = false;
        const cleanup = firmware.onEcuStatus((next) => {
            pushed = true;
            setStatus(next);
        });
        firmware
            .getEcuStatus()
            // A push that arrived meanwhile is newer than the snapshot.
            .then((snapshot) => !pushed && setStatus(snapshot))
            .catch((err) => log.error("[useEcuStatus] Failed to get the ECU status:", err));
        return cleanup;
    }, []);

    return status;
}
