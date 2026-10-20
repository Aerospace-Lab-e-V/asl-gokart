export type EcuId = 'zc_buttons' | 'zc_lights' | 'zc_battery' | 'zc_motor';


/**
 * TODO:
 * ECUs should report their current firmware version via Sero (needs a change in zc/).
 * Until then the ECU Manager shows the version last flashed from this headunit.
 */
export interface EcuDefinition {
    id: EcuId;
    displayName: string;
    /** Asset filename in GitHub releases, e.g. "firmware_zc_battery.bin" */
    githubAssetName: string;
    /** Sero service ID for this ECU (used to route OTA trigger method calls). */
    seroServiceId: number;
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

/** Where a flash stands after the ECU acknowledged the OTA trigger, as tracked by the main process. */
export enum OtaPhase {
    /** Trigger acknowledged, waiting for the ECU to request the binary. */
    WaitingForEcu = 'waiting-for-ecu',
    /** The ECU is downloading the binary from the headunit. */
    EcuDownloading = 'ecu-downloading',
    /** The ECU has the binary; it writes it and restarts. */
    Rebooting = 'rebooting',
    /** The ECU reappeared on Sero after the download. */
    Online = 'online',
    Failed = 'failed',
}

export interface OtaProgress {
    ecuId: EcuId;
    tag: string;
    phase: OtaPhase;
    /** 0-100 while the ECU downloads. */
    percent?: number;
    /** The phase that failed, set with `error`. */
    failedPhase?: OtaPhase;
    error?: string;
}
