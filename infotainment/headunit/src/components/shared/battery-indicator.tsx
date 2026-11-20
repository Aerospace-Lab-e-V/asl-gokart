import { BatteryIndicatorProps } from "@/data/models";
import { SOC_LOW_PCT, SOC_WARN_PCT } from "@/data/battery-config";
import { fmt } from "@/components/drive/format";
import { cn } from "@/lib/utils";
import React from "react";

/** SOC bar fill: red when low, amber when getting low, otherwise the plain foreground. */
export const socTone = (soc: number | null) =>
  soc !== null && soc <= SOC_LOW_PCT ? "bg-red-500" : soc !== null && soc <= SOC_WARN_PCT ? "bg-amber-500" : "bg-foreground";

/** Percent and a battery pill filled to the SOC. Fixed widths, so a changing value never shifts the header. */
const BatteryIndicator = (props: BatteryIndicatorProps) => {
  const level = props.batteryLevel;
  return (
    <div className="flex flex-row items-center gap-2">
      <p className="w-[4ch] text-right text-xl font-medium tabular-nums">{fmt(level)}%</p>
      <div className="flex items-center">
        <div className="h-5 w-10 rounded-[5px] border-2 border-foreground/60 p-[2px]">
          <div data-testid="soc-fill" className={cn("h-full rounded-sm transition-[width] duration-300", socTone(level))} style={{ width: `${level ?? 0}%` }} />
        </div>
        <div className="h-2 w-[3px] rounded-r-sm bg-foreground/60" />
      </div>
    </div>
  );
};

export default BatteryIndicator;
