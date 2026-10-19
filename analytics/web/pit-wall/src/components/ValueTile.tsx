import { signal, type SignalName } from "../live/catalog";
import { useTick } from "../live/hooks";
import { telemetry } from "../live/store";
import { formatValue, label, unit } from "../views/format";

/** Latest value of one signal, refreshed on the shared 10 Hz tick. */
export function ValueTile({ name }: { name: SignalName }) {
    useTick();
    const def = signal(name);
    const latest = telemetry.latest(def.id);
    const u = unit(def);
    return (
        <div className="stats bg-base-200">
            <div className="stat px-4 py-3">
                <div className="stat-title">{label(def)}</div>
                <div className="stat-value text-2xl tabular-nums sm:text-3xl">
                    {formatValue(def, latest?.value)}
                    {u && latest && (
                        <span className="text-base-content/60 ml-1 text-base font-normal">{u}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
