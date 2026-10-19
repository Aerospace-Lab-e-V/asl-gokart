import {
    Chart,
    Legend,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Tooltip,
    type ChartDataset,
    type Scale,
} from "chart.js";
import { useEffect, useRef } from "react";
import { signal } from "../live/catalog";
import { onFrame } from "../live/frame";
import { telemetry, type Point } from "../live/store";
import { formatRelative, formatValue, label, unit } from "../views/format";
import type { ChartDef } from "../views/presets";
import { CHART_COLORS, useTheme } from "../views/theme";

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

/** Without new data (kart offline), the time axis still slides, just less often. */
const IDLE_REDRAW_MS = 500;

function tickStepMs(windowMs: number): number {
    if (windowMs <= 60_000) return 10_000;
    if (windowMs <= 5 * 60_000) return 60_000;
    return 120_000;
}

interface Props {
    chart: ChartDef;
    windowMs: number;
}

/**
 * Rolling line chart over the last `windowMs`, on kart time. Datasets share the
 * telemetry store's arrays; one redraw per animation frame when data changed,
 * no animation. NaN points in the data are breaks (lost batches, link gaps).
 */
export function LiveChart({ chart, windowMs }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const theme = useTheme();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const colors = CHART_COLORS[theme];
        const defs = chart.series.map(signal);
        const shared = unit(defs[0]!);
        const step = tickStepMs(windowMs);
        const now = Date.now();

        const datasets: ChartDataset<"line", Point[]>[] = defs.map((def, i) => ({
            label: label(def),
            data: telemetry.points(def.id),
            borderColor: colors.series[i],
            backgroundColor: colors.series[i],
            borderWidth: 2,
            borderJoinStyle: "round",
            borderCapStyle: "round",
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBorderWidth: 2,
            tension: 0,
            spanGaps: false,
        }));

        const instance = new Chart<"line", Point[]>(canvas, {
            type: "line",
            data: { datasets },
            options: {
                animation: false,
                parsing: false,
                normalized: true,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", axis: "x", intersect: false },
                scales: {
                    x: {
                        type: "linear",
                        min: now - windowMs,
                        max: now,
                        grid: { color: colors.grid },
                        border: { color: colors.grid },
                        // Fixed ticks counted back from "now", so labels stay put while
                        // the data scrolls underneath.
                        afterBuildTicks: (axis: Scale) => {
                            const ticks = [];
                            for (let t = axis.max; t >= axis.min; t -= step)
                                ticks.push({ value: t });
                            axis.ticks = ticks.reverse();
                        },
                        ticks: {
                            color: colors.muted,
                            maxRotation: 0,
                            callback(value) {
                                return formatRelative(Number(value) - this.max);
                            },
                        },
                    },
                    y: {
                        min: chart.range?.[0],
                        max: chart.range?.[1],
                        // Fit the data, but never past the physical range from the
                        // catalog (no "−20 km/h" from tick rounding).
                        afterDataLimits: (axis: Scale) => {
                            axis.min = Math.max(axis.min, Math.min(...defs.map((d) => d.min)));
                            axis.max = Math.min(axis.max, Math.max(...defs.map((d) => d.max)));
                        },
                        grid: { color: colors.grid },
                        border: { display: false },
                        ticks: { color: colors.muted, maxTicksLimit: 5 },
                    },
                },
                plugins: {
                    // One series: the title names it, no legend box.
                    legend: {
                        display: defs.length > 1,
                        position: "top",
                        align: "end",
                        labels: { color: colors.text, boxWidth: 12, boxHeight: 2 },
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const x = items[0]?.parsed.x;
                                return x == null ? "" : formatRelative(x - Date.now());
                            },
                            label: (item) => {
                                const def = defs[item.datasetIndex]!;
                                return `${label(def)}: ${formatValue(def, item.parsed.y)} ${shared}`;
                            },
                        },
                    },
                },
            },
        });

        let lastVersion = -1;
        let lastDraw = 0;
        const stop = onFrame((frameTime) => {
            const version = telemetry.version;
            if (version === lastVersion && frameTime - lastDraw < IDLE_REDRAW_MS) return;
            lastVersion = version;
            lastDraw = frameTime;
            const t = Date.now();
            const x = instance.options.scales!.x!;
            x.min = t - windowMs;
            x.max = t;
            instance.data.datasets.forEach((ds, i) => {
                ds.data = telemetry.points(defs[i]!.id);
            });
            instance.update("none");
        });

        return () => {
            stop();
            instance.destroy();
        };
    }, [chart, windowMs, theme]);

    const u = unit(signal(chart.series[0]!));
    return (
        <div className="card bg-base-200">
            <div className="card-body gap-1 p-3 sm:p-4">
                <h3 className="text-sm font-medium">
                    {chart.title}
                    {u && <span className="text-base-content/60 font-normal"> ({u})</span>}
                </h3>
                <div className="relative h-40 sm:h-48">
                    <canvas ref={canvasRef} role="img" aria-label={`${chart.title} over time`} />
                </div>
            </div>
        </div>
    );
}
