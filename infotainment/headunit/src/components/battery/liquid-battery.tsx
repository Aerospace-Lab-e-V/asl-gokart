import React from "react";
import { FlowState } from "@/domain/signals";
import { SOC_LOW_PCT, SOC_WARN_PCT } from "@/data/battery-config";
import { FLOW_STATE_LABEL } from "@/data/controlling_models/battery";
import { fmt } from "@/components/drive/format";
import { cn } from "@/lib/utils";

export type FlowLevel = 1 | 2 | 3;

interface LiquidBatteryProps {
    /** State of charge, 0-100 %; null shows an empty battery and "--". */
    soc: number | null;
    flow: FlowState | null;
    /** How strongly to draw the flow, from flowLevel(). */
    level: FlowLevel;
}

/**
 * Bubbles in the order they join as the current grows: left edge in % of the liquid, size px, rise s,
 * delay s (negative, so they are mid-flight as soon as charging starts).
 */
const BUBBLES = [
    { left: 16, size: 12, rise: 2.6, delay: -0.4 },
    { left: 60, size: 9, rise: 2.2, delay: -1.5 },
    { left: 38, size: 15, rise: 3.0, delay: -2.3 },
    { left: 76, size: 11, rise: 2.5, delay: -0.9 },
    { left: 27, size: 8, rise: 2.3, delay: -1.9 },
    { left: 50, size: 13, rise: 2.8, delay: -0.1 },
    { left: 8, size: 10, rise: 2.4, delay: -1.2 },
    { left: 68, size: 16, rise: 3.2, delay: -2.8 },
    { left: 33, size: 9, rise: 2.2, delay: -0.7 },
    { left: 84, size: 11, rise: 2.7, delay: -2.0 },
];
const BUBBLE_COUNT: Record<FlowLevel, number> = { 1: 4, 2: 7, 3: 10 };

/** Matches the band-sink animation in tailwind.config.js. */
const BAND_SINK_S = 2.4;
const BAND_OPACITY: Record<FlowLevel, number> = { 1: 0.35, 2: 0.65, 3: 1 };

const liquidTone = (soc: number) => (soc <= SOC_LOW_PCT ? "bg-red-500" : soc <= SOC_WARN_PCT ? "bg-amber-500" : "bg-green-500");

/** Charging: bubbles rise from the bottom and fade just under the surface; more current, more bubbles. */
const Bubbles = ({ level }: { level: FlowLevel }) =>
    BUBBLES.slice(0, BUBBLE_COUNT[level]).map((b) => (
        // The lane is as tall as the liquid, so its -100% carries the bubble to the surface at any charge.
        <div
            key={b.left}
            data-testid="bubble"
            className="animate-bubble-rise absolute inset-y-0 motion-reduce:animate-none"
            style={{ left: `${b.left}%`, width: b.size, animationDuration: `${b.rise}s`, animationDelay: `${b.delay}s` }}
        >
            <div
                className="animate-bubble-wobble absolute -bottom-4 rounded-full border-[1.5px] border-white/60 bg-white/25 motion-reduce:animate-none"
                style={{ width: b.size, height: b.size }}
            />
        </div>
    ));

/** Discharging: soft light bands sink through the liquid; more current, brighter bands. */
const Bands = ({ level }: { level: FlowLevel }) => (
    <div className="absolute inset-0 transition-opacity duration-500" style={{ opacity: BAND_OPACITY[level] }}>
        {[0, 0.5].map((phase) => (
            <div
                key={phase}
                data-testid="band"
                className="animate-band-sink absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-transparent via-white/25 to-transparent motion-reduce:animate-none"
                style={{ animationDelay: `${-phase * BAND_SINK_S}s` }}
            />
        ))}
    </div>
);

const SocText = ({ soc, className, ...rest }: { soc: number | null } & React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("absolute inset-0 flex items-center justify-center", className)} {...rest}>
        <p className="text-6xl tabular-nums">
            {fmt(soc)}
            <span className="text-3xl opacity-60">%</span>
        </p>
    </div>
);

/** Vertical battery filled like a liquid to the state of charge, showing the energy flow inside it. */
export const LiquidBattery = ({ soc, flow, level }: LiquidBatteryProps) => {
    const fill = soc ?? 0;
    const active = flow === FlowState.POWER || flow === FlowState.REGEN;
    return (
        <div className="flex flex-col items-center">
            <div className="bg-foreground/20 h-3.5 w-16 rounded-t-md" />
            <div className="border-foreground/20 h-[380px] w-46 rounded-[2rem] border-[5px] p-1.5">
                {/* Radius of the shell minus its border and padding, so the curves stay concentric. */}
                <div className="relative h-full overflow-hidden rounded-[21px]">
                    <div
                        data-testid="liquid"
                        className={cn("absolute inset-x-0 bottom-0 overflow-hidden transition-[height,background-color] duration-700", soc !== null && liquidTone(soc))}
                        style={{ height: `${fill}%` }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
                        <div className="absolute inset-x-0 top-0 h-0.5 bg-white/40" />
                        {flow === FlowState.REGEN && <Bubbles level={level} />}
                        {flow === FlowState.POWER && <Bands level={level} />}
                    </div>
                    <SocText soc={soc} className="text-foreground" />
                    {/* Dark copy clipped to the liquid, so the number stays readable where the surface crosses it. */}
                    <SocText
                        soc={soc}
                        className="text-green-950 transition-[clip-path] duration-700"
                        style={{ clipPath: `inset(${100 - fill}% 0 0 0)` }}
                        aria-hidden
                    />
                </div>
            </div>
            <p className={cn("mt-4 text-2xl", !active && "text-muted-foreground")}>{flow === null ? "--" : FLOW_STATE_LABEL[flow]}</p>
        </div>
    );
};
