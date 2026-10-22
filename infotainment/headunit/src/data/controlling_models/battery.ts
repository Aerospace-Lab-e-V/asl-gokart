import { FlowState } from "@/domain/signals";

/** "Charging" rather than "Regenerating": a plugged-in charger drives the current the same way. */
export const FLOW_STATE_LABEL: Record<FlowState, string> = {
    [FlowState.POWER]: "Discharging",
    [FlowState.REGEN]: "Charging",
    [FlowState.IDLE]: "Idle",
};
