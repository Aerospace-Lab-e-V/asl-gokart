import { OutgoingPacket } from "../../data/zonecontrollers/packets";
import {
    BatteryCommands,
    LightsCommands,
    MotorCommands,
    Zones,
} from "../../data/zonecontrollers/zonecontrollers";
import { ResolvedInterface } from "../../helpers/ipc/hardware/network-config";
import { AdcStatusData, TinybufStatus } from "../../data/tinybuf/tinybuf-types";

interface ThemeModeContext {
    toggle: () => Promise<boolean>;
    dark: () => Promise<void>;
    light: () => Promise<void>;
    system: () => Promise<boolean>;
    current: () => Promise<"dark" | "light" | "system">;
}

interface ElectronWindow {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
}

interface WebSocketContext {
    send: (message: OutgoingPacket, zone: Zones) => void;
    onThrottleMessage: (callback: (throttleMessage: string) => void) => () => void;
}

interface AppContext {
    getVersion: () => Promise<string>;
    toggleAnalytics: (enabled: boolean) => Promise<boolean>;
    getAnalyticsUrl: () => Promise<string>;
    setAnalyticsUrl: (url: string) => Promise<string>;
    checkAnalyticsConnection: (url: string) => Promise<boolean>;
    setLogLevel: (level: string) => Promise<string>;
    getLogLevel: () => Promise<string>;
    getAnalyticsInterface: () => Promise<ResolvedInterface | null>;
    setAnalyticsInterface: (mac: string | null) => Promise<ResolvedInterface | null>;
    getAutoStart: () => Promise<boolean>;
    setAutoStart: (enabled: boolean) => Promise<boolean>;
    getFullscreenOnStartup: () => Promise<boolean>;
    setFullscreenOnStartup: (enabled: boolean) => Promise<boolean>;
    getDevToolsEnabled: () => Promise<boolean>;
    setDevToolsEnabled: (enabled: boolean) => Promise<boolean>;
    isNetworkReady: () => Promise<boolean>;
    onNetworkStatusChange: (callback: (status: { ready: boolean }) => void) => () => void;
    skipNetworkGate: () => Promise<void>;
}

interface SeroContext {
    // zc_lights
    sendLightsCommand: (command: LightsCommands, value?: any) => void;
    onLightsMessage: (callback: (lightsMessage: string) => void) => () => void;
    // zc_battery
    sendBatteryCommand: (command: BatteryCommands, value?: boolean | boolean[]) => void;
    onBatteryMessage: (callback: (batteryMessage: string) => void) => () => void;
    // zc_motor
    sendMotorCommand: (command: MotorCommands, value?: any) => Promise<boolean>;
    onMotorMessage: (callback: (motorMessage: string) => void) => () => void;
}

interface HardwareContext {
    getAvailableNetworkInterfaces: () => Promise<unknown>;
    getNetworkInterface: () => Promise<ResolvedInterface | null>;
    setNetworkInterface: (mac: string) => Promise<ResolvedInterface | null>;
}

interface FirmwareRelease {
    tag: string;
    version: string;
    publishedAt: string;
    downloadUrl: string;
    isPrerelease: boolean;
}

interface FirmwareContext {
    getReleases: (assetName: string) => Promise<FirmwareRelease[]>;
    downloadFirmware: (
        ecuId: string,
        tag: string,
        downloadUrl: string
    ) => Promise<{ localUrl: string }>;
    triggerOta: (ecuId: string, tag: string) => Promise<{ success: boolean; url: string }>;
    getServerBaseUrl: () => Promise<string>;
    getCachedVersions: () => Promise<Record<string, string[]>>;
}

interface AppRelease {
    tag: string;
    version: string;
    publishedAt: string;
    downloadUrl: string;
    assetName: string;
    assetSize: number;
    isPrerelease: boolean;
}

interface UpdateProgress {
    percent: number;
    bytesDownloaded: number;
    totalBytes: number;
}

interface UpdaterContext {
    getReleases: () => Promise<AppRelease[]>;
    install: (tag: string, downloadUrl: string, assetName: string) => Promise<void>;
    onProgress: (callback: (progress: UpdateProgress) => void) => () => void;
    relaunch: () => Promise<void>;
}

interface TinybufContext {
    sendLedCommand: (on: boolean, sequence?: number) => Promise<boolean>;
    onAdcStatus: (callback: (data: AdcStatusData) => void) => () => void;
    getStatus: () => Promise<TinybufStatus>;
}

declare global {
    interface Window {
        themeMode: ThemeModeContext;
        electronWindow: ElectronWindow;
        websocket: WebSocketContext;
        sero: SeroContext;
        app: AppContext;
        hardware: HardwareContext;
        firmware: FirmwareContext;
        updater: UpdaterContext;
        tinybuf: TinybufContext;
    }
}
