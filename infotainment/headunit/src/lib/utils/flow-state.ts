import { FlowState as Flow } from "@/domain/signals";

/** Below this battery current magnitude (A) the kart counts as idle. */
const IDLE_CURRENT_A = 5;

/**
 * `drive.flow_state` from `battery.current`, as main publishes it.
 * Current sign as the code has always read it: current > 0 is REGEN (into the pack), current < 0 is POWER.
 */
// TODO(A1): firmware daly-bms-uart.h:37 says + = into pack (charge), signals.yaml says + = discharge; verify under load before changing.
export function flowStateFor(batteryCurrent: number): Flow {
    if (Math.abs(batteryCurrent) < IDLE_CURRENT_A) return Flow.IDLE;
    return batteryCurrent > 0 ? Flow.REGEN : Flow.POWER;
}

/**
 * Current magnitudes (A) from which the flow shows at its second and third strength. Regen tops out at about a
 * third of the discharge current (signals.yaml battery.current: -100 to 300 A), so it gets a third of the steps.
 */
const FLOW_LEVEL_A = { power: [30, 90], regen: [10, 30] };

/** How strongly to draw the energy flow, 1-3, from the battery current; 1 when unknown. */
export function flowLevel(batteryCurrent: number | null, flow: Flow | null): 1 | 2 | 3 {
    const [mid, high] = flow === Flow.REGEN ? FLOW_LEVEL_A.regen : FLOW_LEVEL_A.power;
    const a = Math.abs(batteryCurrent ?? 0);
    return a >= high ? 3 : a >= mid ? 2 : 1;
}
