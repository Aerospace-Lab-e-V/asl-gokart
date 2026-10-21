import type { Api } from "../../ipc/api";

declare global {
    interface Window {
        /** The preload surface (src/ipc/api.ts). Renderer code uses it through src/services/*. */
        api: Api;
    }
}
