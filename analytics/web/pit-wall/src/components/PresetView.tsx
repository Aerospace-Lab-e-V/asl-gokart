import type { Preset } from "../views/presets";
import { useWindowMin } from "../views/useWindowMin";
import { LiveChart } from "./LiveChart";
import { ValueTile } from "./ValueTile";

export function PresetView({ preset }: { preset: Preset }) {
    const windowMs = useWindowMin() * 60_000;
    return (
        <div className="flex flex-col gap-3 sm:gap-4">
            <section
                aria-label="Current values"
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5"
            >
                {preset.tiles.map((name) => (
                    <ValueTile key={name} name={name} />
                ))}
            </section>
            <section aria-label="Charts" className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
                {preset.charts.map((chart) => (
                    <LiveChart key={chart.title} chart={chart} windowMs={windowMs} />
                ))}
            </section>
        </div>
    );
}
