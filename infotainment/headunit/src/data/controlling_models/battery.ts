import { FlowState } from "@/domain/signals";

export interface FlowStateDisplay {
    label: string;
    color: string;
}

export const FLOW_STATE_DISPLAY: Record<FlowState, FlowStateDisplay> = {
    [FlowState.POWER]: { label: "Discharging", color: "#fb923c" }, // orange-400
    [FlowState.REGEN]: { label: "Regenerating", color: "#4ade80" }, // green-400
    [FlowState.IDLE]:  { label: "Idle",         color: "#9ca3af" }, // gray-400
};

/** "Charging" rather than "Regenerating": a plugged-in charger drives the current the same way. */
export const FLOW_STATE_LABEL: Record<FlowState, string> = {
    [FlowState.POWER]: "Discharging",
    [FlowState.REGEN]: "Charging",
    [FlowState.IDLE]: "Idle",
};
