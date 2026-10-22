import React, { useEffect, useMemo, useRef } from "react";
import { TEMP_BOUNDARIES, THERMAL_GRID, tempSegments } from "@/data/battery-config";
import { tempRgb, tempScalePct, thermalField } from "@/lib/utils/thermal";
import { useIsDark } from "@/hooks/use-is-dark";
import { cn } from "@/lib/utils";

/** Raster pixels per sensor cell; the browser's smoothing scales the canvas up to the map's size. */
const PX_PER_CELL = 12;
const W = THERMAL_GRID.cols * PX_PER_CELL;
const H = THERMAL_GRID.rows * PX_PER_CELL;

/** Temperature colours with the theme's foreground/20 over the background (Drive's track colour) as the calm middle. */
const useTempSegments = () => {
    const calm = useIsDark() ? "#333845" : "#ccced1";
    return useMemo(() => tempSegments(calm), [calm]);
};

/** Pack temperatures, one per sensor in THERMAL_GRID order, interpolated between the sensors and coloured by °C. */
export const ThermalMap = ({ temps, className }: { temps: (number | null)[]; className?: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const segments = useTempSegments();
    const empty = temps.every((t) => t === null);

    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        const field = thermalField(temps, THERMAL_GRID.cols, THERMAL_GRID.rows, W, H);
        if (!ctx || !field) return;
        const image = ctx.createImageData(W, H);
        field.forEach((t, i) => image.data.set([...tempRgb(t, segments), 255], i * 4));
        ctx.putImageData(image, 0, 0);
    }, [temps, segments]);

    return (
        <div className={cn("bg-foreground/10 relative overflow-hidden rounded-2xl", className)}>
            {!empty && <canvas ref={canvasRef} width={W} height={H} className="size-full" />}
            {/* Gaps between the sensor cells, so the map reads as the pack's layout. */}
            {Array.from({ length: THERMAL_GRID.cols - 1 }, (_, i) => (
                <div key={`col${i}`} className="bg-background absolute inset-y-0 w-[3px] -translate-x-1/2" style={{ left: `${((i + 1) / THERMAL_GRID.cols) * 100}%` }} />
            ))}
            {Array.from({ length: THERMAL_GRID.rows - 1 }, (_, i) => (
                <div key={`row${i}`} className="bg-background absolute inset-x-0 h-[3px] -translate-y-1/2" style={{ top: `${((i + 1) / THERMAL_GRID.rows) * 100}%` }} />
            ))}
        </div>
    );
};

/** The temperature colours as a bar, the legend for ThermalMap, with the pack's average on it like Drive's temperature bars. */
export const TempScale = ({ avg }: { avg: number | null }) => {
    const segments = useTempSegments();
    const gradient = `linear-gradient(to right, ${segments.map((s) => `${s.color} ${tempScalePct(s.value)}%`).join(", ")})`;
    return (
        <div className="flex flex-col gap-y-2">
            <div className="relative h-2 rounded-full" style={{ background: gradient }}>
                {avg !== null && (
                    <div
                        className="bg-foreground ring-background absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition-[left] duration-300"
                        style={{ left: `${tempScalePct(avg)}%` }}
                    />
                )}
            </div>
            <div className="text-muted-foreground flex justify-between text-lg">
                <span>{TEMP_BOUNDARIES[0]}°</span>
                <span>{TEMP_BOUNDARIES[1]}°</span>
            </div>
        </div>
    );
};
