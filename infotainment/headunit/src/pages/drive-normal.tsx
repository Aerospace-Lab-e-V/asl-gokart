import TabsSelector from "@/components/shared/tabs-selector";
import { Progress } from "@/components/ui/progress";
import { useStore } from "@/stores/useStore";
import { useShallow } from "zustand/react/shallow";
import { tabsSelectorStates } from "@/data/controlling_models/drivetrain";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import { HeaderBar } from "@/components/shared/header-bar";
import ResetDailyDistanceDialog from "@/components/shared/reset-daily-distance-dialog";
import React, { useState, useEffect } from "react";
import { LightsCommands } from "@/data/zonecontrollers/zonecontrollers";
import { HazardLights, HighBeam, HvBatteryFault, InverterFault, LowBeam, MotorFault, ParkingLights, TurnSignalLeft, TurnSignalRight } from "@/components/icons/telltale";
import { THROTTLE_BOUNDARIES, THROTTLE_SEGMENTS, RPM_SEGMENTS } from "@/data/gauge-config";
import { interpolateColor } from "@/lib/utils/gauge-utils";
import TemperatureBox from "@/components/shared/temperature-scale/temperature-box";

const DriveNormalPage = () => {

  const [isDarkMode, setIsDarkMode] = useState(
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const { gear, rpm, speed, rpmBoundaries, batteryPercentage, turnSignalRight, turnSignalLeft, hazardLights, headlights, highBeams, tailLights, avgBatteryTemp, leftMotorData, rightMotorData } = useStore(
    useShallow((state) => ({
      gear: state.gear,
      rpm: state.rpm,
      speed: state.speed,
      rpmBoundaries: state.rpmBoundaries,
      batteryPercentage: state.batteryPercentage,
      turnSignalRight: state.turnSignalRight,
      turnSignalLeft: state.turnSignalLeft,
      hazardLights: state.hazardLights,
      headlights: state.headlights,
      highBeams: state.highBeams,
      tailLights: state.tailLights,
      avgBatteryTemp: state.avgBatteryTemp,
      leftMotorData: state.leftMotorData,
      rightMotorData: state.rightMotorData,
    }))
  );

  const leftMotorTemp = leftMotorData?.motorTemp ?? 0;
  const rightMotorTemp = rightMotorData?.motorTemp ?? 0;
  const avgMotorTemp = leftMotorData && rightMotorData ? (leftMotorTemp + rightMotorTemp) / 2 : (leftMotorTemp || rightMotorTemp || 0);

  const leftThrottle = leftMotorData?.throttle ?? 0;
  const rightThrottle = rightMotorData?.throttle ?? 0;
  const avgThrottleRaw = leftMotorData && rightMotorData ? (leftThrottle + rightThrottle) / 2 : (leftThrottle || rightThrottle || 0);
  const displayThrottle = (avgThrottleRaw / 255) * 100;

  const controller1Temp = leftMotorData?.controllerTemp ?? 0;
  const controller2Temp = rightMotorData?.controllerTemp ?? 0;

  // TODO: Convert colors to tailwind-css colors
  // TODO: Transfer color scaling boundaries to individual states (or only max. value) and multiply times 0.75 or 0.5 for the scale.

  return (
    <div className="w-full flex flex-col">
      
      <HeaderBar />

      <div className="flex flex-col items-center justify-center gap-y-2 pt-10">
        <div className="flex flex-row items-center justify-center gap-x-2">
          { (hazardLights && turnSignalLeft && turnSignalRight) ?
            <HazardLights size={36} className="text-green-400" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_HAZARD_LIGHTS)} />
            :
            <HazardLights size={36} className="text-gray-700" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_HAZARD_LIGHTS)} />
          }
        </div>
        <div className="grid grid-cols-3 w-full">
          <div className="flex flex-col items-center justify-center">
            <div className="w-50">
              <CircularProgressbarWithChildren
                value={displayThrottle}
                circleRatio={0.75}
                styles={buildStyles({
                  pathColor: interpolateColor(
                    displayThrottle,
                    THROTTLE_BOUNDARIES[0],
                    THROTTLE_BOUNDARIES[1],
                    THROTTLE_SEGMENTS
                  ),
                  rotation: 1 / 2 + 1 / 8,
                  strokeLinecap: "butt",
                  trailColor: isDarkMode ? "#374151" : "#eee",
                })}
              >
                <p className="font-semibold text-4xl">{displayThrottle.toFixed(0)}%</p>
                <p>Throttle</p>
              </CircularProgressbarWithChildren>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center">
            <div className="flex flex-row items-center gap-x-4">
              { (turnSignalLeft) ?
                <TurnSignalLeft size={36} className="text-green-400" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TURN_SIGNAL_LEFT)} />
                :
                <TurnSignalLeft size={36} className="text-gray-700" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TURN_SIGNAL_LEFT)} />
              }
              <TabsSelector 
                label="" 
                options={tabsSelectorStates().gears}
                defaultValue={gear}  
                value={gear}
                readOnly={true}
                  />
              { (turnSignalRight) ?
                <TurnSignalRight size={36} className="text-green-400" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TURN_SIGNAL_RIGHT)} />
                :
                <TurnSignalRight size={36} className="text-gray-700" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TURN_SIGNAL_RIGHT)} />
              }
            </div>
            <p className="font-semibold text-9xl">{speed.toFixed(0)}</p>
            <p className="font">km/h</p>
          </div>
          <div className="flex flex-col items-center justify-center">
            <div className="w-50">
              <CircularProgressbarWithChildren
                value={rpm}
                circleRatio={0.75}
                minValue={rpmBoundaries[0]}
                maxValue={rpmBoundaries[1]}
                styles={buildStyles({
                  pathColor: interpolateColor(
                    rpm,
                    rpmBoundaries[0],
                    rpmBoundaries[1],
                    RPM_SEGMENTS
                  ),
                  rotation: 1 / 2 + 1 / 8,
                  strokeLinecap: "butt",
                  trailColor: isDarkMode ? "#374151" : "#eee",
                })}
              >
                <p className="font-semibold text-4xl">{rpm}</p>
                <p>RPM</p>
              </CircularProgressbarWithChildren>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 w-full">
          <div className="flex flex-row items-start gap-x-6 justify-evenly">
                {/* Use color text-red-500 if critical or text-orange-400 if warning */}

                {(headlights[0] || headlights[1]) ?
                  <LowBeam size={36} className="text-green-600" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_DRL)} />
                  :
                  <LowBeam size={36} className="text-gray-700" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_DRL)} />
                }
                {(highBeams[0] || highBeams[1]) ?
                  <HighBeam size={36} className="text-blue-600" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_HIGH_BEAMS)} />
                  :
                  <HighBeam size={36} className="text-gray-700" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_HIGH_BEAMS)} />
                }
                {
                  (tailLights) ?
                  <ParkingLights size={36} className="text-green-600" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TAIL_LIGHT)} />
                  :
                  <ParkingLights size={36} className="text-gray-700" onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TAIL_LIGHT)} />
                }

          </div>
          <div className="flex flex-row justify-evenly">
            <ResetDailyDistanceDialog />
          </div>
          <div className="flex flex-row items-end gap-x-6 justify-evenly">
                {/* <HvBatteryFault size={36} className="text-orange-400" /> */}
                <HvBatteryFault size={36} className="text-gray-700" />
                {/* <MotorFault size={36} className="text-green-500" /> */}
                <MotorFault size={36} className="text-gray-700" />
                {/* <InverterFault size={36} className="text-blue-500" /> */}
                <InverterFault size={36} className="text-gray-700" />
          </div>
        </div>
        <div className="w-full flex flex-row justify-center gap-x-4 pt-8">
          <div className="w-1/3 flex flex-col justify-center">
            <TemperatureBox label="Battery" currentTemp={avgBatteryTemp} minTemp={-10} maxTemp={45}></TemperatureBox>
            <TemperatureBox label="Motor" currentTemp={avgMotorTemp} minTemp={-20} maxTemp={50}></TemperatureBox>
          </div>
          <div className="w-1/3 flex flex-col items-center justify-center pt-4">
            <p>Battery</p>
            <Progress className="rounded-md w-full h-10" value={batteryPercentage*100} />
              <p>{(batteryPercentage*100).toFixed(1)}%</p>
          </div>
          <div className="w-1/3 flex flex-col justify-center">
            <TemperatureBox label="Controller 1" currentTemp={controller1Temp} minTemp={-10} maxTemp={50}></TemperatureBox>
            <TemperatureBox label="Controller 2" currentTemp={controller2Temp} minTemp={-10} maxTemp={50}></TemperatureBox>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveNormalPage;
