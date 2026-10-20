import { Label } from "@/components/ui/label";
import { DriveModes } from "@/data/controlling_models/drivetrain";
import React from "react";

/** Not mounted: no ECU publishes the drive mode yet (TODO(firmware), A7). */
const DriveModeIndicator = ({ driveMode }: { driveMode: DriveModes }) => {
    
    const styleClasses: { [key in DriveModes]: string } = {
        [DriveModes.eco]: 'border-green-500 bg-green-500',
        [DriveModes.comfort]: 'border-blue-500 bg-blue-500',
        [DriveModes.sport]: 'border-orange-500 bg-orange-500',
        [DriveModes.ludicrous]: 'border-purple-500 bg-purple-500'
    };

    {}
    let driveModeChar = driveMode.charAt(0).toUpperCase();
    return (
        <div className="flex flex-row items-center justify-between px-2 py-1">
            <Label className={`w-8 text-base font-black border-solid border-2 rounded-lg text-center ${styleClasses[driveMode]}`}>
                {driveModeChar}
            </Label>
        </div>
    );
}

export default DriveModeIndicator;