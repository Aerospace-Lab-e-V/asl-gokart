import { OutgoingPacket } from "../../data/zonecontrollers/packets";
import { BatteryCommands, LightsCommands, MotorCommands, Zones } from "../../data/zonecontrollers/zonecontrollers";
import { ResolvedInterface } from "../../helpers/ipc/hardware/network-config";
import { NetworkGateStatus } from "../../helpers/ipc/network-gate";
import { EcuId, EcuStatusMap, FlashHistory, OtaProgress } from "../../data/ecu/ecu-types";

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
    setLogLevel: (level: string) => Promise<string>;
    getLogLevel: () => Promise<string>;
    getAutoStart: () => Promise<boolean>;
    setAutoStart: (enabled: boolean) => Promise<boolean>;
    getFullscreenOnStartup: () => Promise<boolean>;
    setFullscreenOnStartup: (enabled: boolean) => Promise<boolean>;
    getDevToolsEnabled: () => Promise<boolean>;
    setDevToolsEnabled: (enabled: boolean) => Promise<boolean>;
    getNetworkGateStatus: () => Promise<NetworkGateStatus>;
    onNetworkStatusChange: (callback: (status: NetworkGateStatus) => void) => () => void;
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
    downloadFirmware: (ecuId: string, tag: string, downloadUrl: string) => Promise<{ localUrl: string }>;
    triggerOta: (ecuId: string, tag: string) => Promise<{ success: boolean; url: string }>;
    getServerBaseUrl: () => Promise<string>;
    getCachedVersions: () => Promise<Record<string, string[]>>;
    getEcuStatus: () => Promise<EcuStatusMap>;
    getFlashHistory: () => Promise<FlashHistory>;
    /** Pushes the whole map whenever an ECU goes online or offline. Returns the cleanup. */
    onEcuStatus: (callback: (status: EcuStatusMap) => void) => () => void;
    /** The flash in progress for this ECU, or null. */
    getOtaProgress: (ecuId: EcuId) => Promise<OtaProgress | null>;
    /** Pushes each step of a flash after the trigger was sent. Returns the cleanup. */
    onOtaProgress: (callback: (progress: OtaProgress) => void) => () => void;
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
    }
}
