import React from "react";
import { HeaderBar } from "@/components/shared/header-bar";
import { BatteryBar } from "@/components/drive/battery-bar";
import { GearRow } from "@/components/drive/gear-row";
import { LightRow } from "@/components/drive/light-row";
import { Speed } from "@/components/drive/speed";
import { BatteryTempLamp, MotorTempLamp, PowerLimitedLamp } from "@/components/drive/warning-lamps";

/** Classic without the arcs and temperatures: a larger speed, every lamp where it is on Classic. */
const MinimalDrive = () => (
    <div className="flex h-full w-full flex-col">
        <HeaderBar />

        <LightRow />

        <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center">
            <div className="flex justify-end">
                <div className="flex flex-col pr-6">
                    <PowerLimitedLamp />
                    <BatteryTempLamp />
                </div>
            </div>
            <div className="flex flex-col items-center gap-y-4">
                <GearRow />
                <Speed className="text-[14rem]" />
                <BatteryBar />
            </div>
            <div className="flex flex-col pl-6">
                <MotorTempLamp />
            </div>
        </div>
    </div>
);

export default MinimalDrive;
