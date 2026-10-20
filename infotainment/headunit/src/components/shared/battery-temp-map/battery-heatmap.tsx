import { DataPoint } from "@mars3d/heatmap.js";
import HeatmapComponent from "./heatmap-component";
import React from "react";

interface BatteryHeatmapProps {
    /** One per sensor in grid order; null (no valid reading) leaves its cell empty. */
    tempValues: (number | null)[];
    width: number;
    height: number;
    maxTemp: number;
    minTemp: number;
}

const BatteryHeatmap = (props: BatteryHeatmapProps) => {
    const totalPoints = props.tempValues.length;
    const numCols = 2; // Always 2 columns
    const numRows = Math.ceil(totalPoints / numCols); // Calculate number of rows needed

    // Calculate the size of each cell in the grid
    const cellWidth = props.width / numCols;
    const cellHeight = props.height / numRows;

    // Generate the data points
    const data: DataPoint[] = props.tempValues.flatMap((temp, index) => {
        if (temp === null) return [];
        const row = Math.floor(index / numCols);
        const col = index % numCols;

        return [{
            x: col * cellWidth + cellWidth / 2,
            y: row * cellHeight + cellHeight / 2,
            value: temp,
        }];
    });

    return (
        <div 
            style={{ width: props.width+7.5, height: props.height+7.5 }} 
            className="flex flex-col items-center rounded-xl overflow-hidden border-4"
        >
            <div >
                <HeatmapComponent 
                    data={data} 
                    width={props.width} 
                    height={props.height} 
                    min={props.minTemp} 
                    max={props.maxTemp} 
                />
            </div>
        </div>
    );
};

export default BatteryHeatmap;
