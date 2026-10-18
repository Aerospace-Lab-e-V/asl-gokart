import { SIGNALS, type SignalDef, type SignalName } from "../gen/signals";

export type { SignalDef, SignalName };

const byId = new Map<number, SignalDef>(SIGNALS.map((s) => [s.id, s]));
const byName = new Map<string, SignalDef>(SIGNALS.map((s) => [s.name, s]));

export const signals: readonly SignalDef[] = SIGNALS;

/** Catalog entry for a wire id, or undefined for ids from a newer kart-agent. */
export function signalById(id: number): SignalDef | undefined {
    return byId.get(id);
}

export function signal(name: SignalName): SignalDef {
    // Every SignalName comes from the generated catalog, so the lookup cannot fail.
    return byName.get(name)!;
}
