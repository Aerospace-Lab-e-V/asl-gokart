import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CH } from "./channels";
import type { SignalBatch } from "@/domain/signals";
import type { Command, CommandResult } from "@/domain/commands";
import type { NetworkGateStatus } from "@/helpers/ipc/network-gate";
import type { ResolvedInterface } from "@/helpers/ipc/hardware/network-config";
import type { EcuId, EcuStatusMap, FirmwareRelease, FlashHistory, OtaProgress } from "@/data/ecu/ecu-types";
import type { AppRelease, UpdateProgress } from "@/data/updater/updater-types";
import type { AgentState, ConfigPatch, ConfigReply } from "@/services/kart-agent/schema";
import type { LogLevel } from "@/lib/logger";
import type { NetworkInterfaceInfo } from "os";

/*
 * The whole surface the renderer gets, exposed as `window.api`. Its type is the type of this object
 * (`src/lib/types/ipc.d.ts`), so there is no hand-written duplicate to drift.
 * Renderer code reaches it only through `src/services/*`, never from views.
 */

const call =
    <T, A extends unknown[] = []>(channel: string) =>
    (...args: A): Promise<T> =>
        ipcRenderer.invoke(channel, ...args);

/** Subscribes to a push channel; returns the unsubscribe. */
const listen =
    <T>(channel: string) =>
    (callback: (value: T) => void): (() => void) => {
        const listener = (_: IpcRendererEvent, value: T) => callback(value);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    };

export const api = {
    window: {
        minimize: call<void>(CH.window.minimize),
        maximize: call<void>(CH.window.maximize),
        close: call<void>(CH.window.close),
    },
    theme: {
        current: call<"dark" | "light" | "system">(CH.theme.current),
        toggle: call<boolean>(CH.theme.toggle),
        dark: call<void>(CH.theme.dark),
        light: call<void>(CH.theme.light),
        system: call<boolean>(CH.theme.system),
    },
    app: {
        getVersion: call<string>(CH.app.version),
        getLogLevel: call<LogLevel>(CH.app.getLogLevel),
        setLogLevel: call<LogLevel, [LogLevel]>(CH.app.setLogLevel),
        getAutoStart: call<boolean>(CH.app.getAutoStart),
        setAutoStart: call<boolean, [boolean]>(CH.app.setAutoStart),
        getFullscreenOnStartup: call<boolean>(CH.app.getFullscreenOnStartup),
        setFullscreenOnStartup: call<boolean, [boolean]>(CH.app.setFullscreenOnStartup),
        getDevToolsEnabled: call<boolean>(CH.app.getDevTools),
        setDevToolsEnabled: call<boolean, [boolean]>(CH.app.setDevTools),
    },
    networkGate: {
        getStatus: call<NetworkGateStatus>(CH.networkGate.getStatus),
        onStatus: listen<NetworkGateStatus>(CH.networkGate.status),
        skip: call<void>(CH.networkGate.skip),
    },
    signals: {
        snapshot: call<SignalBatch>(CH.signals.snapshot),
        onBatch: listen<SignalBatch>(CH.signals.batch),
    },
    command: call<CommandResult, [Command]>(CH.command),
    hardware: {
        getAvailableNetworkInterfaces: call<Record<string, NetworkInterfaceInfo[] | undefined>>(CH.hardware.getAvailableNetworkInterfaces),
        getNetworkInterface: call<ResolvedInterface | null>(CH.hardware.getNetworkInterface),
        setNetworkInterface: call<ResolvedInterface | null, [mac: string]>(CH.hardware.setNetworkInterface),
        getConnection: call<boolean>(CH.hardware.getConnection),
        onConnection: listen<boolean>(CH.hardware.connection),
    },
    firmware: {
        getReleases: call<FirmwareRelease[], [ecuId: EcuId]>(CH.firmware.getReleases),
        /** Main resolves the download URL from the tag; the renderer never supplies one. */
        download: call<{ localUrl: string }, [ecuId: EcuId, tag: string]>(CH.firmware.download),
        triggerOta: call<{ success: boolean; url: string }, [ecuId: EcuId, tag: string]>(CH.firmware.triggerOta),
        getServerBaseUrl: call<string>(CH.firmware.getServerUrl),
        getCachedVersions: call<Record<string, string[]>>(CH.firmware.getCachedVersions),
        getEcuStatus: call<EcuStatusMap>(CH.firmware.getEcuStatus),
        onEcuStatus: listen<EcuStatusMap>(CH.firmware.ecuStatus),
        getFlashHistory: call<FlashHistory>(CH.firmware.getFlashHistory),
        getOtaProgress: call<OtaProgress | null, [ecuId: EcuId]>(CH.firmware.getOtaProgress),
        onOtaProgress: listen<OtaProgress>(CH.firmware.otaProgress),
    },
    updater: {
        getReleases: call<AppRelease[]>(CH.updater.getReleases),
        /** Main resolves URL and asset from the tag. */
        install: call<void, [tag: string]>(CH.updater.install),
        onProgress: listen<UpdateProgress>(CH.updater.progress),
        relaunch: call<void>(CH.updater.relaunch),
    },
    agent: {
        getState: call<AgentState>(CH.agent.getState),
        onState: listen<AgentState>(CH.agent.state),
        getConfig: call<ConfigReply>(CH.agent.getConfig),
        putConfig: call<ConfigReply, [ConfigPatch]>(CH.agent.putConfig),
    },
    admin: {
        unlock: call<boolean, [pin: string]>(CH.admin.unlock),
        lock: call<void>(CH.admin.lock),
        get: call<boolean>(CH.admin.get),
        onState: listen<boolean>(CH.admin.state),
    },
};

export type Api = typeof api;

export const exposeApi = () => contextBridge.exposeInMainWorld("api", api);
