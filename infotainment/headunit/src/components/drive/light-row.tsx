import React from "react";
import { DaytimeRunningLights, HazardLights, HighBeam, HvBatteryFault, MotorFault, ParkingLights } from "@/components/icons/telltale";
import { LightToggle } from "@/components/drive/light-toggle";
import { Lamp, offline } from "@/components/drive/warning-lamps";
import { useEcuStatus } from "@/hooks/useEcuStatus";

/** Light buttons stay centred; the fault lamps beside them only show while lit. */
export const LightRow = () => {
    const ecus = useEcuStatus();
    return (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-10">
            <div />
            <div className="flex gap-x-2">
                <LightToggle signal="lights.drl" light="drl" label="daytime running lights" icon={DaytimeRunningLights} onClassName="text-green-600 dark:text-green-500" />
                <LightToggle signal="lights.high_beam_left" orSignal="lights.high_beam_right" light="high_beam" label="high beams" icon={HighBeam} onClassName="text-blue-600 dark:text-blue-500" />
                <LightToggle signal="lights.tail" light="tail" label="tail lights" icon={ParkingLights} onClassName="text-green-600 dark:text-green-500" />
                <LightToggle signal="lights.hazard" light="hazard" label="hazard lights" icon={HazardLights} onClassName="text-green-600 dark:text-green-500" fault={offline(ecus, "zc_lights")} />
            </div>
            <div className="flex gap-x-2">
                <Lamp icon={HvBatteryFault} tone={offline(ecus, "zc_battery") ? "red" : null} label="Battery controller not connected" />
                <Lamp icon={MotorFault} tone={offline(ecus, "zc_motor") ? "red" : null} label="Motor controller not connected" />
            </div>
        </div>
    );
};
