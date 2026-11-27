import type { ConfigPatch } from "@/services/kart-agent/schema";

/** kart-agent configuration, proxied by main. Its status arrives in `stores/agent.ts`. */
export const agent = {
    getConfig: () => window.api.agent.getConfig(),
    putConfig: (patch: ConfigPatch) => window.api.agent.putConfig(patch),
    /** Admin only: request a certificate for the uplink; an admin approves the shown code on the VM. */
    enroll: (requestedId?: string) => window.api.agent.enroll(requestedId),
    cancelEnroll: () => window.api.agent.cancelEnroll(),
};
