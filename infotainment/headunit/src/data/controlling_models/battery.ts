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
