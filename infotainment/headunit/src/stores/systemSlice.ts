import { StateCreator } from "zustand"
import type { LogLevel } from "@/lib/logger"
import type { AgentStatus } from "@/services/kart-agent/schema"

export interface SystemSlice {
    adminPin: string,
    adminMode: boolean,
    appVersion: string,
    gokartLanConnected: boolean,
    /** Last status read from kart-agent; kept while it is unreachable. */
    kartAgentStatus: AgentStatus | null,
    /** Why the last poll of kart-agent failed; null while it answers. */
    kartAgentError: string | null,
    showParticleEffects: boolean,
    logLevel: LogLevel,
    autoStart: boolean,
    fullscreenOnStartup: boolean,
    devToolsEnabled: boolean,
    setAdminPin: (adminPin: string) => void,
    setAppVersion: (appVersion: string) => void,
    setGokartLanConnected: (connected: boolean) => void,
    setKartAgentStatus: (status: AgentStatus) => void,
    setKartAgentError: (error: string) => void,
    setShowParticleEffects: (showParticleEffects: boolean) => void,
    setLogLevel: (logLevel: LogLevel) => void,
    setAutoStart: (autoStart: boolean) => void,
    setFullscreenOnStartup: (fullscreenOnStartup: boolean) => void,
    setDevToolsEnabled: (devToolsEnabled: boolean) => void,
  }

export const createSystemSlice: StateCreator<
    SystemSlice,
    [],
    [],
    SystemSlice
    > = (set) => ({
    adminPin: "",
    adminMode: false,
    appVersion: "unknown",
    gokartLanConnected: false,
    kartAgentStatus: null,
    kartAgentError: null,
    showParticleEffects: true,
    logLevel: "info",
    autoStart: false,
    fullscreenOnStartup: false,
    devToolsEnabled: true,
    setAdminPin: (adminPin: string) => set({ adminPin }),
    setAppVersion: (appVersion: string) => set({ appVersion }),
    setGokartLanConnected: (gokartLanConnected: boolean) => set({ gokartLanConnected }),
    setKartAgentStatus: (kartAgentStatus: AgentStatus) => set({ kartAgentStatus, kartAgentError: null }),
    setKartAgentError: (kartAgentError: string) => set({ kartAgentError }),
    setShowParticleEffects: (showParticleEffects: boolean) => set({ showParticleEffects }),
    setLogLevel: (logLevel: LogLevel) => set({ logLevel }),
    setAutoStart: (autoStart: boolean) => set({ autoStart }),
    setFullscreenOnStartup: (fullscreenOnStartup: boolean) => set({ fullscreenOnStartup }),
    setDevToolsEnabled: (devToolsEnabled: boolean) => set({ devToolsEnabled }),
})