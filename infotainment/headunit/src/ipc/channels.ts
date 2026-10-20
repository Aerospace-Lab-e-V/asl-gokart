/** Every IPC channel between main and the preload. Main registers handlers on these; the preload `api` calls them. */
export const CH = {
    window: {
        minimize: "window:minimize",
        maximize: "window:maximize",
        close: "window:close",
    },
    theme: {
        current: "theme-mode:current",
        toggle: "theme-mode:toggle",
        dark: "theme-mode:dark",
        light: "theme-mode:light",
        system: "theme-mode:system",
    },
    app: {
        version: "app-version",
        setLogLevel: "app-set-log-level",
        getLogLevel: "app-get-log-level",
        getAutoStart: "app-get-auto-start",
        setAutoStart: "app-set-auto-start",
        getFullscreenOnStartup: "app-get-fullscreen-startup",
        setFullscreenOnStartup: "app-set-fullscreen-startup",
        getDevTools: "app-get-dev-tools",
        setDevTools: "app-set-dev-tools",
    },
    networkGate: {
        getStatus: "network-gate:get-status",
        /** push NetworkGateStatus */
        status: "network-gate:status",
        skip: "network-gate:skip",
    },
    signals: {
        /** invoke -> SignalBatch with every known signal */
        snapshot: "signals:snapshot",
        /** push SignalBatch, at most every 50 ms */
        batch: "signals:batch",
    },
    /** invoke(Command) -> CommandResult */
    command: "command",
    hardware: {
        getAvailableNetworkInterfaces: "get-available.network-interfaces",
        getNetworkInterface: "get-network-interface",
        setNetworkInterface: "set-network-interface",
        /** invoke -> boolean */
        getConnection: "hardware:get-connection",
        /** push boolean: car network interface has an address */
        connection: "hardware:connection",
    },
    firmware: {
        getReleases: "firmware:get-releases",
        download: "firmware:download",
        triggerOta: "firmware:trigger-ota",
        getServerUrl: "firmware:get-server-url",
        getCachedVersions: "firmware:get-cached-versions",
        getEcuStatus: "firmware:get-ecu-status",
        ecuStatus: "firmware:ecu-status",
        getFlashHistory: "firmware:get-flash-history",
        getOtaProgress: "firmware:get-ota-progress",
        otaProgress: "firmware:ota-progress",
    },
    updater: {
        getReleases: "updater:get-releases",
        install: "updater:install",
        progress: "updater:progress",
        relaunch: "updater:relaunch",
    },
    agent: {
        /** invoke -> AgentState */
        getState: "agent:get-state",
        /** push AgentState, every poll */
        state: "agent:state",
        getConfig: "agent:get-config",
        putConfig: "agent:put-config",
    },
    admin: {
        /** invoke(pin) -> boolean */
        unlock: "admin:unlock",
        lock: "admin:lock",
        /** invoke -> boolean */
        get: "admin:get",
        /** push boolean */
        state: "admin:state",
    },
} as const;
