import type { ConfigPatch } from "@/services/kart-agent/schema";

/** kart-agent configuration, proxied by main. Its status arrives in `stores/agent.ts`. */
export const agent = {
    getConfig: () => window.api.agent.getConfig(),
    putConfig: (patch: ConfigPatch) => window.api.agent.putConfig(patch),
};
