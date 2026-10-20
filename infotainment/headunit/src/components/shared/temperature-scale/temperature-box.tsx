import React from "react";
import TemperatureScale from "./temperature-scale";

interface TemperatureBoxProps {
    label: string;
    maxTemp: number;
    minTemp: number;
    /** null: no reading, the scale shows no marker. */
    currentTemp: number | null;
}

const TemperatureBox = ({ label, currentTemp, minTemp, maxTemp }: TemperatureBoxProps) => {
    return (
        <div className="flex flex-row items-center justify-center">
            <div className="flex flex-col w-1/2 items-center justify-center p-1 overflow-hidden">
                <p>{label}</p>
                {/* <Progress value={50} /> */}
                <TemperatureScale currentTemp={currentTemp} minTemp={minTemp} maxTemp={maxTemp} />
            </div>
        </div>

    );
}

export default TemperatureBox;