import React from "react";
import { SOC_LOW_PCT, SOC_WARN_PCT } from "@/data/battery-config";
import { fmt } from "@/components/drive/format";
import { useSignal } from "@/stores/signals";
import { cn } from "@/lib/utils";

export const BatteryBar = () => {
    const soc = useSignal("battery.soc");
    const tone = soc !== null && soc <= SOC_LOW_PCT ? "bg-red-500" : soc !== null && soc <= SOC_WARN_PCT ? "bg-amber-500" : "bg-foreground";
    return (
        <div className="flex w-96 items-center gap-x-3 text-lg text-muted-foreground">
            <span>Battery</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-foreground/20">
                <div className={cn("h-full rounded-full transition-[width] duration-300", tone)} style={{ width: `${soc ?? 0}%` }} />
            </div>
            <span className="w-16 text-right tabular-nums">{fmt(soc, 1)}%</span>
        </div>
    );
};
