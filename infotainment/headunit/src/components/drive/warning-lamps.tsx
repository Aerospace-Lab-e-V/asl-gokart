import React, { createContext, useContext } from "react";
import { BatteryTemperature, MotorTemperature, PowerLimited, type TelltaleIcon } from "@/components/icons/telltale";
import { BATTERY_TEMP_HOT_C, BATTERY_TEMP_WARN_C } from "@/data/battery-config";
import { MOTOR_TEMP_HOT_C, MOTOR_TEMP_WARN_C } from "@/data/motor-config";
import type { EcuId } from "@/data/ecu/ecu-types";
import { highest } from "@/components/drive/format";
import { tempTone, type LampTone } from "@/components/drive/lamps";
import { useSignal } from "@/stores/signals";
import type { useEcuStatus } from "@/hooks/useEcuStatus";
import { useSmoothed } from "@/hooks/use-smoothed";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<LampTone, string> = {
    yellow: "text-yellow-500 dark:text-yellow-400",
    orange: "text-orange-500 dark:text-orange-400",
    red: "text-red-600 dark:text-red-500",
};

/** True while every warning lamp is lit for the bulb check; provided once by the Drive page for all styles. */
export const BulbCheck = createContext(false);

/**
 * Warning lamp, hidden while off but keeping its place, so lamps do not shift as others light up.
 * Red blinks for a few seconds when it comes on, so the driver notices the fault. `label` names the lit state
 * for screen readers; `checkTone` is the colour it shows during the bulb check.
 */
export const Lamp = ({ icon: Icon, tone, label, size = 48, checkTone = "red" }: { icon: TelltaleIcon; tone: LampTone | null; label: string; size?: number; checkTone?: LampTone }) => {
    const checking = useContext(BulbCheck);
    const shown = checking ? checkTone : tone;
    return (
        <Icon
            size={size}
            title={tone ? label : undefined}
            className={cn(
                "m-2",
                shown ? `${TONE_CLASS[shown]} dark:drop-shadow-[0_0_4px_currentColor]` : "invisible",
                // The animation runs once, each time the class is added.
                !checking && tone === "red" && "animate-lamp-blink",
            )}
        />
    );
};

/** Lamps beside the speed. */
const GAUGE_LAMP_SIZE = 64;

/** Red while the ECU is not connected; off until its status is known. */
export const offline = (status: ReturnType<typeof useEcuStatus>, ecu: EcuId) => status !== null && !status[ecu].online;

export const BatteryTempLamp = () => (
    <Lamp icon={BatteryTemperature} tone={tempTone(useSignal("battery.temp"), BATTERY_TEMP_WARN_C, BATTERY_TEMP_HOT_C)} label="Battery temperature high" size={GAUGE_LAMP_SIZE} />
);

export const MotorTempLamp = () => {
    // Smoothed like the readout, so the lamp does not flicker at a threshold.
    const temp = useSmoothed(highest(useSignal("temp.motor_left"), useSignal("temp.motor_right")));
    return <Lamp icon={MotorTemperature} tone={tempTone(temp, MOTOR_TEMP_WARN_C, MOTOR_TEMP_HOT_C)} label="Motor temperature high" size={GAUGE_LAMP_SIZE} />;
};

/* TODO(firmware): no ECU reports a power limit yet; light it orange once zc_motor does. */
export const PowerLimitedLamp = () => <Lamp icon={PowerLimited} tone={null} label="Power limited" size={GAUGE_LAMP_SIZE} checkTone="orange" />;
