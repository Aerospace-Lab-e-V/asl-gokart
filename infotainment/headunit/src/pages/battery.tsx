import BatteryHeatmap from "@/components/shared/battery-temp-map/battery-heatmap";
import { HeaderBar } from "@/components/shared/header-bar";
import React from "react";
import { useShallow } from "zustand/react/shallow";
import {
    CircularProgressbarWithChildren,
    buildStyles,
} from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import { SOC_BOUNDARIES, SOC_SEGMENTS, HEATMAP_MIN_TEMP, HEATMAP_MAX_TEMP } from "@/data/battery-config";
import { FLOW_STATE_DISPLAY } from "@/data/controlling_models/battery";
import { interpolateColor } from "@/lib/utils/gauge-utils";
import type { FlowState, SignalName } from "@/domain/signals";
import { readSignal, useSignal, useSignals } from "@/stores/signals";
import { useIsDark } from "@/hooks/use-is-dark";
import { fmt } from "@/components/drive/format";

const TEMP_SIGNALS: SignalName[] = [
    "battery.temp_1", "battery.temp_2", "battery.temp_3", "battery.temp_4", "battery.temp_5",
    "battery.temp_6", "battery.temp_7", "battery.temp_8", "battery.temp_9", "battery.temp_10",
];

const SocGauge = () => {
    const isDark = useIsDark();
    const soc = useSignal("battery.soc");
    return (
        <div className="w-48">
            <CircularProgressbarWithChildren
                value={soc ?? 0}
                styles={buildStyles({
                    pathColor: interpolateColor(soc ?? 0, SOC_BOUNDARIES[0], SOC_BOUNDARIES[1], SOC_SEGMENTS),
                    trailColor: isDark ? "#374151" : "#eee",
                    strokeLinecap: "round",
                })}
            >
                <div className="flex flex-col items-center">
                    <span className="text-4xl font-bold">{fmt(soc)}%</span>
                    <span className="text-xs text-muted-foreground">State of Charge</span>
                </div>
            </CircularProgressbarWithChildren>
        </div>
    );
};

const FlowLabel = () => {
    const flow = useSignal("drive.flow_state") as FlowState | null;
    const { label, color } = (flow !== null && FLOW_STATE_DISPLAY[flow]) || { label: "--", color: undefined };
    return <span style={{ color }} className="text-2xl font-semibold">{label}</span>;
};

const Tile = ({ value, label }: { value: string; label: string }) => (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-3 px-2">
        <span className="text-3xl font-bold">{value}</span>
        <span className="text-xs text-muted-foreground mt-1">{label}</span>
    </div>
);

const Voltage = () => <Tile value={fmt(useSignal("battery.voltage"), 1)} label="Voltage (V)" />;

const Current = () => {
    const current = useSignal("battery.current");
    return <Tile value={fmt(current === null ? null : Math.abs(current), 1)} label="Current (A)" />;
};

const Power = () => {
    const power = useSignal("battery.power");
    const kw = power !== null && power >= 1000;
    return <Tile value={kw ? fmt(power / 1000, 2) : fmt(power)} label={`Power (${kw ? "kW" : "W"})`} />;
};

const TempRow = ({ label, signal }: { label: string; signal: SignalName }) => (
    <div className="flex flex-row justify-between items-center">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold">{fmt(useSignal(signal), 1)} °C</span>
    </div>
);

const Heatmap = () => {
    const temps = useSignals(useShallow(() => TEMP_SIGNALS.map((name) => readSignal(name))));
    return <BatteryHeatmap tempValues={temps} width={256} height={256} minTemp={HEATMAP_MIN_TEMP} maxTemp={HEATMAP_MAX_TEMP} />;
};

const BatteryPage = () => {
    return (
        <div className="flex flex-col w-full h-screen">
            <HeaderBar />

            <div className="flex flex-row flex-1 items-center gap-4 p-4 pt-2">

                {/* Left column: State of Charge + flow state */}
                <div className="flex flex-col items-center justify-center gap-4 w-[40%]">
                    <SocGauge />
                    <FlowLabel />
                </div>

                {/* Right column: Electrical values + temperature */}
                <div className="flex flex-col flex-1 gap-3">

                    {/* Electrical values row */}
                    <div className="grid grid-cols-3 gap-3">
                        <Voltage />
                        <Current />
                        <Power />
                    </div>

                    {/* Temperature section */}
                    <div className="flex flex-row flex-1 gap-4 rounded-xl border bg-card p-3">
                        <Heatmap />
                        <div className="flex flex-col justify-evenly flex-1">
                            <TempRow label="Average" signal="battery.temp_avg" />
                            <TempRow label="Min" signal="battery.temp_min" />
                            <TempRow label="Max" signal="battery.temp" />
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

export default BatteryPage;
