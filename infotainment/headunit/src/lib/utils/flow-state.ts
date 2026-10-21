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
