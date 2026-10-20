// Flow state enum for particle effects and motor visualization
export enum FlowState {
    POWER = 'power',
    REGEN = 'regen',
    IDLE = 'idle'
}

// Calculate flow state based on battery current
// Battery current > 0 means power consumption (discharge)
// Battery current < 0 means regeneration (charge)
export const calculateFlowState = (batteryCurrent: number): FlowState => {
    // If battery current magnitude is below threshold, consider idle
    if (Math.abs(batteryCurrent) < 5) {
        return FlowState.IDLE;
    }
    // Negative current = discharging = power mode
    // Positive current = charging = regen mode
    return batteryCurrent > 0 ? FlowState.REGEN : FlowState.POWER;
}
