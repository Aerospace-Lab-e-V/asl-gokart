import React from "react";
import { HeaderBar } from "@/components/shared/header-bar";
import { BatteryBar } from "@/components/drive/battery-bar";
import { GearRow } from "@/components/drive/gear-row";
import { LightRow } from "@/components/drive/light-row";
import { Speed } from "@/components/drive/speed";
import { BatteryTempLamp, MotorTempLamp, PowerLimitedLamp } from "@/components/drive/warning-lamps";
import { DriveMap } from "@/components/drive/map/drive-map";

/** Minimal with the speed moved left and a live map filling the right half; the lamps keep their sides of the speed. */
const MapDrive = () => (
    <div className="flex h-full w-full flex-col">
        <HeaderBar />

        <LightRow />

        <div className="grid min-h-0 flex-1 grid-cols-[auto_auto_auto_1fr]">
            <div className="flex flex-col justify-center pl-4 pr-2">
                <PowerLimitedLamp />
                <BatteryTempLamp />
            </div>
            <div className="flex flex-col items-center justify-center gap-y-4">
                <GearRow />
                <Speed className="text-[12rem]" />
                <BatteryBar />
            </div>
            <div className="flex flex-col justify-center px-2">
                <MotorTempLamp />
            </div>
            <DriveMap />
        </div>
    </div>
);

export default MapDrive;
