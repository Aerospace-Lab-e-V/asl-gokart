// ProgressComponent.jsx
import * as  Progress from '@radix-ui/react-progress';
import React from 'react';

interface TemperatureScaleProps {
    currentTemp: number | null;
    minTemp: number;
    maxTemp: number;
}



const TemperatureScale = ({ currentTemp, minTemp, maxTemp }: TemperatureScaleProps) => {
    const clampedTemp = Math.max(minTemp, Math.min(currentTemp ?? minTemp, maxTemp));
    const range = maxTemp - minTemp;
    const percentage = ((clampedTemp - minTemp) / range) * 100;


  return (
    <Progress.Root className='rounded-lg px-2 w-full h-4 relative z-0 overflow-visible bg-gradient-to-r from-blue-500 via-zinc-200 to-red-500'>
        {/*  */}
        <div className='flex w-full h-full'>
            {/*  */}
            {currentTemp !== null && <div style={{ marginLeft: `${percentage}%` }} className='temperature-indicator-container flex justify-center items-center relative w-5 h-full -left-1 ease-in-out z-0'>
                <div
                    className='absolute w-1 h-4 bg-black rounded-lg z-20 ease-in-out'
                />
                {/* Gradient */}
                <div 
                    className='absolute w-5 h-full z-10 bg-gradient-to-r from-transparent via-white to-transparent'
                />
            </div>}
        </div>


    </Progress.Root>
  );
};

export default TemperatureScale;
