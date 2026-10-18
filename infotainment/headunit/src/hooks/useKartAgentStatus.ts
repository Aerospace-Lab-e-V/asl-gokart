import { useEffect, useState } from "react";
import { getStatus } from "@/services/kart-agent/client";
import { AgentStatus } from "@/services/kart-agent/schema";

const POLL_MS = 1000;

/** Polls kart-agent's status while the calling component is mounted. */
export function useKartAgentStatus(): { status: AgentStatus | null; error: string | null } {
    const [status, setStatus] = useState<AgentStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            try {
                const next = await getStatus();
                if (!cancelled) {
                    setStatus(next);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            }
        };
        poll();
        const timer = setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    return { status, error };
}
