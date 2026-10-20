export type EcuId = 'zc_buttons' | 'zc_lights' | 'zc_battery' | 'zc_motor';


/**
 * TODO:
 * This data should all come from the ECUs themselves.
 * ECUs should report their current firmware version and 
 * online status via Sero telemetry / self-description on connect.
 */
export interface EcuDefinition {
    id: EcuId;
    displayName: string;
    /** Asset filename in GitHub releases, e.g. "firmware_zc_battery.bin" */
    githubAssetName: string;
    /** Sero service ID for this ECU (used to route OTA trigger method calls). */
    seroServiceId: number;
    /** Mock current firmware version until ECUs report their own */
    mockCurrentVersion: string;
    /** Mock online status until real telemetry is available */
    mockOnline: boolean;
}

/** Reachability of one ECU, from Sero service discovery. */
export interface EcuPresence {
    online: boolean;
    /** Set while online. */
    ip?: string;
    /** Epoch ms of the last change. */
    changedAt: number;
}

export type EcuStatusMap = Record<EcuId, EcuPresence>;

/** The last version flashed to each ECU from this headunit and confirmed back online. */
export type FlashHistory = Partial<Record<EcuId, { tag: string; flashedAt: string }>>;

export interface FirmwareRelease {
    tag: string;
    version: string;
    publishedAt: string;
    downloadUrl: string;
    isPrerelease: boolean;
}

export enum OtaPhase {
    Idle = 'idle',
    Downloading = 'downloading',
    Flashing = 'flashing',
    Success = 'success',
    Error = 'error',
}

export interface OtaState {
    phase: OtaPhase;
    error?: string;
}
