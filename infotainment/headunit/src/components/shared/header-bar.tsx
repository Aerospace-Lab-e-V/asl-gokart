import { Lock, Unlock, Cloud, CloudCheck, CloudAlert, CloudOff, EthernetPort, Unplug } from "lucide-react";
import DigitalClock from "./clock";
import BatteryIndicator from "./battery-indicator";
import React from "react";
import { useNavigate } from "react-router-dom";
import { overall } from "@/services/kart-agent/health";
import { useSignal } from "@/stores/signals";
import { useSession } from "@/stores/session";
import { useApp } from "@/stores/app";
import { useAgent } from "@/stores/agent";

export const HeaderBar = () => {

    const navigate = useNavigate();
    const telemetry = useAgent((state) => overall(state.status, state.error));
    const adminMode = useSession((state) => state.adminMode);
    const lanConnected = useApp((state) => state.lanConnected);
    const soc = useSignal("battery.soc");

    return (
        <div className="flex flex-row items-center justify-between px-4 py-2">
            <div className="flex flex-row items-center gap-4 min-w-28">
                {/* TODO(firmware): no ECU publishes the drive mode (A7); re-mount <DriveModeIndicator driveMode=... /> when one does. */}
                <div className="flex flex-row items-center gap-2 text-muted-foreground">
                    {lanConnected === null ? <EthernetPort className="w-8 h-8" /> : lanConnected ? <EthernetPort className="w-8 h-8 text-green-600 dark:text-green-500" /> : <Unplug className="w-8 h-8 text-red-500" />}
                    {/* Telemetry: red when nothing is recorded, otherwise the pit wall uplink. */}
                    <button type="button" aria-label="Telemetry" className="-m-2 p-2" onClick={() => navigate("/telemetry")}>
                        {telemetry === "ok" && <CloudCheck className="w-8 h-8 text-green-600 dark:text-green-500" />}
                        {telemetry === "warn" && <CloudAlert className="w-8 h-8 text-yellow-500" />}
                        {telemetry === "fault" && <CloudAlert className="w-8 h-8 text-red-500" />}
                        {telemetry === "off" && <CloudOff className="w-8 h-8" />}
                        {telemetry === "unknown" && <Cloud className="w-8 h-8" />}
                    </button>
                </div>
            </div>
            <DigitalClock />
            <div className="flex min-w-28 justify-end items-center">
            { adminMode ? <Unlock className="w-8 h-8 mr-3 text-red" /> : <Lock className="w-8 h-8 mr-3" /> }
            <BatteryIndicator batteryLevel={soc} />
            </div>
        </div>
    );
}