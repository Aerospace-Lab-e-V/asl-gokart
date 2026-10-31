import { HeaderBar } from "@/components/shared/header-bar";
import React from "react";
import { THROTTLE_BOUNDARIES, RPM_BOUNDARIES, throttleSegments, rpmSegments, Segment } from "@/data/gauge-config";
import { interpolateColor } from "@/lib/utils/gauge-utils";
import { avg, fmt } from "@/components/drive/format";
import { BatteryBar } from "@/components/drive/battery-bar";
import { GearRow } from "@/components/drive/gear-row";
import { LightRow } from "@/components/drive/light-row";
import { Speed } from "@/components/drive/speed";
import { BatteryTempLamp, BulbCheck, MotorTempLamp, PowerLimitedLamp } from "@/components/drive/warning-lamps";
import { useBulbCheck } from "@/hooks/use-bulb-check";
import { useSignal } from "@/stores/signals";
import { useIsDark } from "@/hooks/use-is-dark";
import { useSmoothed } from "@/hooks/use-smoothed";
import { cn } from "@/lib/utils";

/*
 * Both arcs are drawn on one ellipse spanning the gauge area (viewBox units, stretched to fit),
 * each covering ±ARC_HALF degrees around its side and filling bottom to top.
 */
const VIEW = { w: 1000, h: 400 };
const ARC_HALF = 55;
const arcPath = (side: "left" | "right") => {
  const rx = VIEW.w / 2 - 20, ry = VIEW.h / 2 - 20, cx = VIEW.w / 2, cy = VIEW.h / 2;
  const at = (deg: number) => `${cx + rx * Math.cos((deg * Math.PI) / 180)} ${cy + ry * Math.sin((deg * Math.PI) / 180)}`;
  return side === "left"
    ? `M ${at(180 - ARC_HALF)} A ${rx} ${ry} 0 0 1 ${at(180 + ARC_HALF)}`
    : `M ${at(ARC_HALF)} A ${rx} ${ry} 0 0 0 ${at(-ARC_HALF)}`;
};

/** Edge arc plus readout; null renders an empty track and "--". */
const ArcGauge = ({ value, unit, label, bounds, segments, side }: { value: number | null; unit: string; label: string; bounds: [number, number]; segments: (fg: string) => Segment[]; side: "left" | "right" }) => {
  const fg = useIsDark() ? "#f8fafc" : "#020817";
  const v = Math.max(bounds[0], Math.min(value ?? bounds[0], bounds[1]));
  const pct = ((v - bounds[0]) / (bounds[1] - bounds[0])) * 100;
  const d = arcPath(side);
  const color = interpolateColor(v, bounds[0], bounds[1], segments(fg));
  return (
    <div className={cn("flex flex-col", side === "left" ? "items-start pl-16" : "items-end pr-16")}>
      {/* Positioned against the gauge area, not this column, so both arcs share one ellipse. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="none" fill="none">
        <path d={d} className="stroke-foreground/20" strokeWidth={12} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {value !== null && (
          <path
            d={d}
            pathLength={100}
            strokeDasharray={`${pct} 100`}
            stroke="currentColor"
            strokeWidth={12}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="transition-[stroke-dasharray] duration-150 dark:drop-shadow-[0_0_4px_currentColor]"
            style={{ color }}
          />
        )}
      </svg>
      <p className="text-5xl tabular-nums">
        {fmt(value)}
        <span className="text-2xl text-muted-foreground">{unit}</span>
      </p>
      <p className="text-lg text-muted-foreground">{label}</p>
    </div>
  );
};

const ThrottleGauge = () => (
  <ArcGauge value={useSignal("drive.throttle")} unit="%" label="Throttle" bounds={THROTTLE_BOUNDARIES} segments={throttleSegments} side="left" />
);

const RpmGauge = () => {
  const rpm = avg(useSignal("drive.rpm_left"), useSignal("drive.rpm_right"));
  return <ArcGauge value={rpm} unit="" label="RPM" bounds={RPM_BOUNDARIES} segments={rpmSegments} side="right" />;
};

/** Label, value and a cold-to-hot bar; null shows "--" and no marker. */
const TempReadout = ({ label, value, min, max }: { label: string; value: number | null; min: number; max: number }) => {
  const pct = value === null ? null : ((Math.max(min, Math.min(value, max)) - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-lg text-muted-foreground">{label}</span>
        <span className="text-2xl font-medium tabular-nums">{fmt(value)}°C</span>
      </div>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-blue-500/70 via-foreground/20 to-red-500/70">
        {pct !== null && (
          <div className="bg-foreground ring-background absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition-[left] duration-300" style={{ left: `${pct}%` }} />
        )}
      </div>
    </div>
  );
};

const BatteryTemp = () => <TempReadout label="Battery" value={useSignal("battery.temp_avg")} min={-10} max={45} />;

/* Motor and controller temperatures come from the Kelly controllers, which flip between neighbouring whole °C. */
const MotorTemp = () => {
  const temp = useSmoothed(avg(useSignal("temp.motor_left"), useSignal("temp.motor_right")));
  return <TempReadout label="Motor" value={temp} min={-20} max={50} />;
};

const ControllerTemp = ({ label, signal }: { label: string; signal: "temp.esc_left" | "temp.esc_right" }) => (
  <TempReadout label={label} value={useSmoothed(useSignal(signal))} min={-10} max={50} />
);

/** Throttle and RPM arcs around the speed, temperatures below. */
const ClassicDrive = () => (
  <div className="flex h-full w-full flex-col">
    <HeaderBar />

    <LightRow />

    <div className="relative grid flex-1 grid-cols-[1fr_auto_1fr] items-center">
      {/* Lamps sit against the speed column, so a wider readout does not move them. */}
      <div className="flex items-center justify-between">
        <ThrottleGauge />
        <div className="flex flex-col pr-6">
          <PowerLimitedLamp />
          <BatteryTempLamp />
        </div>
      </div>
      <div className="flex flex-col items-center gap-y-4">
        <GearRow />
        <Speed />
        <BatteryBar />
        {/* TODO(firmware): no ECU publishes trip distance; re-mount <ResetDailyDistanceDialog /> when one does. */}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col pl-6">
          <MotorTempLamp />
        </div>
        <RpmGauge />
      </div>
    </div>

    <div className="grid grid-cols-4 gap-x-10 px-10 pt-2 pb-6">
      <BatteryTemp />
      <MotorTemp />
      <ControllerTemp label="Controller 1" signal="temp.esc_left" />
      <ControllerTemp label="Controller 2" signal="temp.esc_right" />
    </div>
  </div>
);

const DriveNormalPage = () => (
  <BulbCheck.Provider value={useBulbCheck()}>
    <ClassicDrive />
  </BulbCheck.Provider>
);

export default DriveNormalPage;
