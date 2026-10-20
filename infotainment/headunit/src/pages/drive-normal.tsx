import TabsSelector from "@/components/shared/tabs-selector";
import { Progress } from "@/components/ui/progress";
import { Gears, tabsSelectorStates } from "@/data/controlling_models/drivetrain";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import { HeaderBar } from "@/components/shared/header-bar";
import React from "react";
import { Construction, Lightbulb, OctagonAlert, Spotlight, SquareArrowLeft, SquareArrowRight, TriangleAlert } from "lucide-react";
import { THROTTLE_BOUNDARIES, THROTTLE_SEGMENTS, RPM_SEGMENTS, Segment } from "@/data/gauge-config";
import { interpolateColor } from "@/lib/utils/gauge-utils";
import TemperatureBox from "@/components/shared/temperature-scale/temperature-box";
import { LightToggle } from "@/components/drive/light-toggle";
import { avg, fmt } from "@/components/drive/format";
import { useSignal } from "@/stores/signals";
import { useIsDark } from "@/hooks/use-is-dark";

const RPM_BOUNDARIES: [number, number] = [0, 1500];

/** Three-quarter ring gauge; null renders an empty ring and "--". */
const Gauge = ({ value, unit, label, bounds, segments }: { value: number | null; unit: string; label: string; bounds: [number, number]; segments: Segment[] }) => {
  const isDark = useIsDark();
  const v = value ?? bounds[0];
  return (
    <div className="w-50">
      <CircularProgressbarWithChildren
        value={v}
        circleRatio={0.75}
        minValue={bounds[0]}
        maxValue={bounds[1]}
        styles={buildStyles({
          pathColor: interpolateColor(v, bounds[0], bounds[1], segments),
          rotation: 1 / 2 + 1 / 8,
          strokeLinecap: "butt",
          trailColor: isDark ? "#374151" : "#eee",
        })}
      >
        <p className="font-semibold text-4xl">{fmt(value)}{unit}</p>
        <p>{label}</p>
      </CircularProgressbarWithChildren>
    </div>
  );
};

const ThrottleGauge = () => (
  <Gauge value={useSignal("drive.throttle")} unit="%" label="Throttle" bounds={THROTTLE_BOUNDARIES} segments={THROTTLE_SEGMENTS} />
);

const RpmGauge = () => {
  const rpm = avg(useSignal("drive.rpm_left"), useSignal("drive.rpm_right"));
  return <Gauge value={rpm} unit="" label="RPM" bounds={RPM_BOUNDARIES} segments={RPM_SEGMENTS} />;
};

const GearIndicator = () => {
  const reverse = useSignal("drive.reverse");
  // No tab selected while unknown.
  const gear = reverse === null ? "" : reverse === 1 ? Gears.r : Gears.d;
  return <TabsSelector label="" options={tabsSelectorStates().gears} defaultValue={gear} value={gear} readOnly={true} />;
};

const Speed = () => {
  const speed = useSignal("drive.speed");
  return <p className="font-semibold text-9xl">{fmt(speed)}</p>;
};

const BatteryBar = () => {
  const soc = useSignal("battery.soc");
  return (
    <div className="w-1/3 flex flex-col items-center justify-center pt-4">
      <p>Battery</p>
      <Progress className="rounded-md w-full h-10" value={soc ?? 0} />
      <p>{fmt(soc, 1)}%</p>
    </div>
  );
};

const BatteryTemp = () => (
  <TemperatureBox label="Battery" currentTemp={useSignal("battery.temp_avg")} minTemp={-10} maxTemp={45} />
);

const MotorTemp = () => {
  const temp = avg(useSignal("temp.motor_left"), useSignal("temp.motor_right"));
  return <TemperatureBox label="Motor" currentTemp={temp} minTemp={-20} maxTemp={50} />;
};

const ControllerTemp = ({ label, signal }: { label: string; signal: "temp.esc_left" | "temp.esc_right" }) => (
  <TemperatureBox label={label} currentTemp={useSignal(signal)} minTemp={-10} maxTemp={50} />
);

const DriveNormalPage = () => {
  // TODO: Convert colors to tailwind-css colors
  // TODO: Transfer color scaling boundaries to individual states (or only max. value) and multiply times 0.75 or 0.5 for the scale.

  return (
    <div className="w-full flex flex-col">

      <HeaderBar />

      <div className="flex flex-col items-center justify-center gap-y-2 pt-10">
        <div className="flex flex-row items-center justify-center gap-x-2">
          <LightToggle signal="lights.hazard" light="hazard" label="hazard lights" icon={TriangleAlert} onClassName="text-green-400" />
        </div>
        <div className="grid grid-cols-3 w-full">
          <div className="flex flex-col items-center justify-center">
            <ThrottleGauge />
          </div>
          <div className="flex flex-col items-center justify-center">
            <div className="flex flex-row items-center gap-x-4">
              <LightToggle signal="lights.turn_left" light="turn_left" label="left turn signal" icon={SquareArrowLeft} onClassName="text-green-400" />
              <GearIndicator />
              <LightToggle signal="lights.turn_right" light="turn_right" label="right turn signal" icon={SquareArrowRight} onClassName="text-green-400" />
            </div>
            <Speed />
            <p className="font">km/h</p>
          </div>
          <div className="flex flex-col items-center justify-center">
            <RpmGauge />
          </div>
        </div>
        <div className="grid grid-cols-3 w-full">
          <div className="flex flex-row items-start gap-x-6 justify-evenly">
                {/* Use color text-red-500 if critical or text-orange-400 if warning */}
                <LightToggle signal="lights.drl" light="drl" label="daytime running lights" icon={Lightbulb} onClassName="text-green-600" />
                <LightToggle signal="lights.high_beam_left" orSignal="lights.high_beam_right" light="high_beam" label="high beams" icon={Spotlight} onClassName="text-blue-600" />
                <LightToggle signal="lights.tail" light="tail" label="tail lights" icon={Construction} onClassName="text-green-600" />
          </div>
          <div className="flex flex-row justify-evenly">
            {/* TODO(firmware): no ECU publishes trip distance; re-mount <ResetDailyDistanceDialog /> when one does. */}
          </div>
          <div className="flex flex-row items-end gap-x-6 justify-evenly">
                {/* <OctagonAlert size={36} className="text-orange-400" /> */}
                <OctagonAlert size={36} className="text-gray-700" />
                {/* <OctagonAlert size={36} className="text-green-500" /> */}
                <OctagonAlert size={36} className="text-gray-700" />
                {/* <OctagonAlert size={36} className="text-blue-500" /> */}
                <OctagonAlert size={36} className="text-gray-700" />
          </div>
        </div>
        <div className="w-full flex flex-row justify-center gap-x-4 pt-8">
          <div className="w-1/3 flex flex-col justify-center">
            <BatteryTemp />
            <MotorTemp />
          </div>
          <BatteryBar />
          <div className="w-1/3 flex flex-col justify-center">
            <ControllerTemp label="Controller 1" signal="temp.esc_left" />
            <ControllerTemp label="Controller 2" signal="temp.esc_right" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveNormalPage;
