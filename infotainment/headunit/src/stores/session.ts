import { create } from "zustand";
import type { FlowState } from "@/domain/signals";
import type { DriveStyleId } from "@/pages/drive/styles";

interface SessionState {
    /** Mirror of main's admin state; main enforces it on privileged IPC. Written by `services/bridge.ts`. */
    adminMode: boolean;
    showParticleEffects: boolean;
    /** Debug: force the particle flow state instead of drive.flow_state. */
    flowStateOverride: FlowState | null;
    /** Look of the Drive page; back to classic on every start. */
    driveStyle: DriveStyleId;
}

/** UI state of this run. Lost on restart. */
export const useSession = create<SessionState>(() => ({
    adminMode: false,
    showParticleEffects: true,
    flowStateOverride: null,
    driveStyle: "classic",
}));

export const setShowParticleEffects = (showParticleEffects: boolean) => useSession.setState({ showParticleEffects });
export const setFlowStateOverride = (flowStateOverride: FlowState | null) => useSession.setState({ flowStateOverride });
export const setDriveStyle = (driveStyle: DriveStyleId) => useSession.setState({ driveStyle });
