import { Gears } from "@/data/controlling_models/drivetrain";
import { HeaderBar } from "@/components/shared/header-bar";
import React from "react";
import {
    BatteryTemperature,
    DaytimeRunningLights,
    HazardLights,
    HighBeam,
    HvBatteryFault,
    MotorFault,
    MotorTemperature,
    ParkingLights,
    PowerLimited,
    TurnSignalLeft,
    TurnSignalRight,
    type TelltaleIcon,
} from "@/components/icons/telltale";
import { THROTTLE_BOUNDARIES, RPM_BOUNDARIES, throttleSegments, rpmSegments, Segment } from "@/data/gauge-config";
import { BATTERY_TEMP_HOT_C, BATTERY_TEMP_WARN_C, SOC_LOW_PCT, SOC_WARN_PCT } from "@/data/battery-config";
import { MOTOR_TEMP_HOT_C, MOTOR_TEMP_WARN_C } from "@/data/motor-config";
import type { EcuId } from "@/data/ecu/ecu-types";
import { interpolateColor } from "@/lib/utils/gauge-utils";
import { LightToggle } from "@/components/drive/light-toggle";
import { avg, fmt, highest } from "@/components/drive/format";
import { gearFor, tempTone, type LampTone } from "@/components/drive/lamps";
import { useSignal } from "@/stores/signals";
import { useIsDark } from "@/hooks/use-is-dark";
import { useEcuStatus } from "@/hooks/useEcuStatus";
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

const GEAR_ORDER: [Gears, string][] = [[Gears.p, "P"], [Gears.r, "R"], [Gears.n, "N"], [Gears.d, "D"]];

const GearIndicator = () => {
  const gear = gearFor(useSignal("drive.relay_1"), useSignal("drive.reverse"));
  return (
    <div className="flex gap-x-5 text-4xl">
      {GEAR_ORDER.map(([g, label]) => (
        <span key={g} className={g === gear ? "font-semibold text-foreground" : "text-muted-foreground/60"}>{label}</span>
      ))}
    </div>
  );
};

const Speed = () => {
  const speed = useSignal("drive.speed");
  return (
    <div className="flex flex-col items-center">
      <p className="text-[10rem] leading-none tracking-tight tabular-nums">{fmt(speed)}</p>
      <p className="text-2xl text-muted-foreground">km/h</p>
    </div>
  );
};

const BatteryBar = () => {
  const soc = useSignal("battery.soc");
  const tone = soc !== null && soc <= SOC_LOW_PCT ? "bg-red-500" : soc !== null && soc <= SOC_WARN_PCT ? "bg-amber-500" : "bg-foreground";
  return (
    <div className="flex w-96 items-center gap-x-3 text-lg text-muted-foreground">
      <span>Battery</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-foreground/20">
        <div className={cn("h-full rounded-full transition-[width] duration-300", tone)} style={{ width: `${soc ?? 0}%` }} />
      </div>
      <span className="w-16 text-right tabular-nums">{fmt(soc, 1)}%</span>
    </div>
  );
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

const TONE_CLASS: Record<LampTone, string> = {
  yellow: "text-yellow-500 dark:text-yellow-400",
  orange: "text-orange-500 dark:text-orange-400",
  red: "text-red-600 dark:text-red-500",
};

/**
 * Warning lamp, hidden while off but keeping its place, so lamps do not shift as others light up.
 * `label` names the lit state for screen readers.
 */
const Lamp = ({ icon: Icon, tone, label, size = 48 }: { icon: TelltaleIcon; tone: LampTone | null; label: string; size?: number }) => (
  <Icon
    size={size}
    title={tone ? label : undefined}
    className={cn("m-2", tone ? `${TONE_CLASS[tone]} dark:drop-shadow-[0_0_4px_currentColor]` : "invisible")}
  />
);

/** Lamps between the arc gauges and the speed. */
const GAUGE_LAMP_SIZE = 64;

/** Red while the ECU is not connected; off until its status is known. */
const offline = (status: ReturnType<typeof useEcuStatus>, ecu: EcuId) => status !== null && !status[ecu].online;

const BatteryTempLamp = () => (
  <Lamp icon={BatteryTemperature} tone={tempTone(useSignal("battery.temp"), BATTERY_TEMP_WARN_C, BATTERY_TEMP_HOT_C)} label="Battery temperature high" size={GAUGE_LAMP_SIZE} />
);

const MotorTempLamp = () => {
  // Smoothed like the readout, so the lamp does not flicker at a threshold.
  const temp = useSmoothed(highest(useSignal("temp.motor_left"), useSignal("temp.motor_right")));
  return <Lamp icon={MotorTemperature} tone={tempTone(temp, MOTOR_TEMP_WARN_C, MOTOR_TEMP_HOT_C)} label="Motor temperature high" size={GAUGE_LAMP_SIZE} />;
};

/* TODO(firmware): no ECU reports a power limit yet; light it orange once zc_motor does. */
const PowerLimitedLamp = () => <Lamp icon={PowerLimited} tone={null} label="Power limited" size={GAUGE_LAMP_SIZE} />;

const DriveNormalPage = () => {
  const ecus = useEcuStatus();
  return (
    <div className="flex h-full w-full flex-col">
      <HeaderBar />

      {/* Light buttons stay centred; the fault lamps beside them only show while lit. */}
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
          <div className="flex items-center gap-x-6">
            <LightToggle signal="lights.turn_left" light="turn_left" label="left turn signal" icon={TurnSignalLeft} onClassName="text-green-600 dark:text-green-500" />
            <GearIndicator />
            <LightToggle signal="lights.turn_right" light="turn_right" label="right turn signal" icon={TurnSignalRight} onClassName="text-green-600 dark:text-green-500" />
          </div>
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
};

export default DriveNormalPage;
