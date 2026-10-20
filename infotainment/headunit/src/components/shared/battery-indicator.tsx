import { BatteryIndicatorProps } from "@/data/models";
import { Battery, BatteryFull, BatteryLow, BatteryMedium } from "lucide-react";
import { fmt } from "@/components/drive/format";
import React from "react";

const BatteryIndicator = (props: BatteryIndicatorProps) => {
  const level = props.batteryLevel;
  return (
    <div className="flex flex-row gap-2 items-center justify-center font-bold text-3xl">
      <p>{fmt(level)}%</p>
      {level === null && <Battery className="w-[1em] h-[1em]" />}
      {level !== null && level > 85 && <BatteryFull className="w-[1em] h-[1em]" />}
      {level !== null && level <= 85 && level > 25 && <BatteryMedium className="w-[1em] h-[1em]" />}
      {level !== null && level <= 25 && <BatteryLow className="w-[1em] h-[1em]" />}
    </div>
  );
};

export default BatteryIndicator;
