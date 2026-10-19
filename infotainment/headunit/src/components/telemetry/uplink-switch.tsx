import React, { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/stores/useStore";
import { getStatus, putConfig } from "@/services/kart-agent/client";
import log from "@/lib/logger";

/** Switches kart-agent's live uplink to the pit wall. Applied by the agent without a restart. */
export const UplinkSwitch = ({ id }: { id?: string }) => {
    const enabled = useStore((state) => state.kartAgentStatus?.live.enabled ?? false);
    const reachable = useStore((state) => state.kartAgentStatus !== null && state.kartAgentError === null);
    const setKartAgentStatus = useStore((state) => state.setKartAgentStatus);
    const [busy, setBusy] = useState(false);

    const toggle = async (next: boolean) => {
        setBusy(true);
        try {
            await putConfig({ live: { enabled: next } });
            // Show the new state now instead of after the next poll.
            setKartAgentStatus(await getStatus());
        } catch (e) {
            log.error(e);
            toast.error(`Could not switch the uplink: ${e instanceof Error ? e.message : e}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Switch
            id={id}
            aria-label="Send telemetry to the pit wall"
            checked={enabled}
            disabled={!reachable || busy}
            onCheckedChange={toggle}
        />
    );
};
