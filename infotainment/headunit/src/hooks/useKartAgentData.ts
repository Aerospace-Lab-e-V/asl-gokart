import { useEffect } from "react";
import { useStore } from "@/stores/useStore";
import { getStatus } from "@/services/kart-agent/client";

const POLL_MS = 1000;

/** Polls kart-agent's status into the store, for the header bar and the Telemetry page. */
export function useKartAgentData() {
    const setKartAgentStatus = useStore((state) => state.setKartAgentStatus);
    const setKartAgentError = useStore((state) => state.setKartAgentError);

    useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            try {
                const status = await getStatus();
                if (!cancelled) setKartAgentStatus(status);
            } catch (e) {
                if (!cancelled) setKartAgentError(e instanceof Error ? e.message : String(e));
            }
        };
        poll();
        const timer = setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [setKartAgentStatus, setKartAgentError]);
}
