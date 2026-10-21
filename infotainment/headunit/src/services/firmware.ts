import type { EcuId, EcuStatusMap, OtaProgress } from "@/data/ecu/ecu-types";

/** ECU firmware releases and OTA flashing. Main resolves every URL from the tag. */
export const firmware = {
    getReleases: (ecuId: EcuId) => window.api.firmware.getReleases(ecuId),
    download: (ecuId: EcuId, tag: string) => window.api.firmware.download(ecuId, tag),
    /** Rejects when main refuses, e.g. while the kart is moving or admin mode is locked. */
    triggerOta: (ecuId: EcuId, tag: string) => window.api.firmware.triggerOta(ecuId, tag),
    getCachedVersions: () => window.api.firmware.getCachedVersions(),
    getEcuStatus: () => window.api.firmware.getEcuStatus(),
    onEcuStatus: (callback: (status: EcuStatusMap) => void) => window.api.firmware.onEcuStatus(callback),
    getFlashHistory: () => window.api.firmware.getFlashHistory(),
    getOtaProgress: (ecuId: EcuId) => window.api.firmware.getOtaProgress(ecuId),
    onOtaProgress: (callback: (progress: OtaProgress) => void) => window.api.firmware.onOtaProgress(callback),
};
