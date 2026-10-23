import { HeaderBar } from "@/components/shared/header-bar";
import React from "react";
import { useShallow } from "zustand/react/shallow";
import { LiquidBattery } from "@/components/battery/liquid-battery";
import { TempScale, ThermalMap } from "@/components/battery/thermal-map";
import { flowLevel } from "@/lib/utils/flow-state";
import type { FlowState, SignalName } from "@/domain/signals";
import { readSignal, useSignal, useSignals } from "@/stores/signals";
import { fmt } from "@/components/drive/format";

const TEMP_SIGNALS: SignalName[] = [
    "battery.temp_1", "battery.temp_2", "battery.temp_3", "battery.temp_4", "battery.temp_5",
    "battery.temp_6", "battery.temp_7", "battery.temp_8", "battery.temp_9", "battery.temp_10",
];

/** Value with a muted unit and label, as on the Drive page. */
const Reading = ({ value, unit, label }: { value: string; unit: string; label: string }) => (
    <div>
        <p className="text-5xl tabular-nums">
            {value}
            <span className="text-muted-foreground ml-1 text-2xl">{unit}</span>
        </p>
        <p className="text-muted-foreground text-lg">{label}</p>
    </div>
);

/** Magnitude only: the battery's flow animation shows the direction. */
const abs = (v: number | null) => (v === null ? null : Math.abs(v));

const Voltage = () => <Reading value={fmt(useSignal("battery.voltage"), 1)} unit="V" label="Voltage" />;

const Current = () => <Reading value={fmt(abs(useSignal("battery.current")))} unit="A" label="Current" />;

const Power = () => <Reading value={fmt(abs(useSignal("battery.power")), 1)} unit="kW" label="Power" />;

const Battery = () => {
    const soc = useSignal("battery.soc");
    const flow = useSignal("drive.flow_state") as FlowState | null;
    // Selected as the level, so the 10 Hz current only re-renders the battery when the level changes.
    const level = useSignals(() => flowLevel(readSignal("battery.current"), readSignal("drive.flow_state") as FlowState | null));
    return <LiquidBattery soc={soc} flow={flow} level={level} />;
};

const Temperatures = () => {
    const temps = useSignals(useShallow(() => TEMP_SIGNALS.map((name) => readSignal(name))));
    const max = useSignal("battery.temp");
    const avg = useSignal("battery.temp_avg");
    const min = useSignal("battery.temp_min");
    return (
        <div className="flex flex-col gap-y-5">
            <div className="flex items-center gap-x-5">
                <ThermalMap temps={temps} className="h-[280px] w-32" />
                <div className="flex flex-col gap-y-8">
                    <Reading value={fmt(max, 1)} unit="°C" label="Highest" />
                    <Reading value={fmt(avg, 1)} unit="°C" label="Average" />
                    <Reading value={fmt(min, 1)} unit="°C" label="Lowest" />
                </div>
            </div>
            <TempScale avg={avg} />
        </div>
    );
};

const BatteryPage = () => (
    <div className="flex h-full w-full flex-col">
        <HeaderBar />

        <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-x-8 px-8 pb-6">
            <div className="flex flex-col gap-y-8 justify-self-center">
                <Voltage />
                <Current />
                <Power />
            </div>
            <Battery />
            <div className="justify-self-center">
                <Temperatures />
            </div>
        </div>
    </div>
);

export default BatteryPage;
