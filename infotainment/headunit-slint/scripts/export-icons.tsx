// Renders the drive page's icons to static SVGs for the Slint UI.
// Run from headunit-slint/: bun scripts/export-icons.tsx (needs headunit/node_modules installed).
import React from "react";
import { renderToStaticMarkup } from "../../headunit/node_modules/react-dom/server";
import { writeFileSync } from "node:fs";
import * as telltale from "../../headunit/src/components/icons/telltale";
import { Battery, BatteryFull, BatteryLow, BatteryMedium, Cloud, EthernetPort, Lock } from "../../headunit/node_modules/lucide-react";

const icons: Record<string, React.FC<{ size?: number }>> = {
    drl: telltale.DaytimeRunningLights,
    high_beam: telltale.HighBeam,
    tail: telltale.ParkingLights,
    hazard: telltale.HazardLights,
    turn_left: telltale.TurnSignalLeft,
    turn_right: telltale.TurnSignalRight,
    hv_battery_fault: telltale.HvBatteryFault,
    motor_fault: telltale.MotorFault,
    inverter_fault: telltale.InverterFault,
    battery: Battery,
    battery_full: BatteryFull,
    battery_medium: BatteryMedium,
    battery_low: BatteryLow,
    cloud: Cloud,
    ethernet: EthernetPort,
    lock: Lock,
};

for (const [name, Icon] of Object.entries(icons)) {
    writeFileSync(new URL(`../ui/icons/${name}.svg`, import.meta.url), renderToStaticMarkup(<Icon size={48} />) + "\n");
}
console.log(`wrote ${Object.keys(icons).length} icons`);
