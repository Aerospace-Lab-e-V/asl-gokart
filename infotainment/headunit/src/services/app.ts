import type { LogLevel } from "@/lib/logger";
import type { NetworkGateStatus } from "@/helpers/ipc/network-gate";

/** Main-process settings of the app. Each setter resolves to the value main applied. */
export const app = {
    getLogLevel: () => window.api.app.getLogLevel(),
    setLogLevel: (level: LogLevel) => window.api.app.setLogLevel(level),
    getAutoStart: () => window.api.app.getAutoStart(),
    setAutoStart: (enabled: boolean) => window.api.app.setAutoStart(enabled),
    getFullscreenOnStartup: () => window.api.app.getFullscreenOnStartup(),
    setFullscreenOnStartup: (enabled: boolean) => window.api.app.setFullscreenOnStartup(enabled),
    getDevToolsEnabled: () => window.api.app.getDevToolsEnabled(),
    setDevToolsEnabled: (enabled: boolean) => window.api.app.setDevToolsEnabled(enabled),
};

/** The boot screen that waits for the car network. */
export const networkGate = {
    getStatus: () => window.api.networkGate.getStatus(),
    onStatus: (callback: (status: NetworkGateStatus) => void) => window.api.networkGate.onStatus(callback),
    skip: () => window.api.networkGate.skip(),
};
