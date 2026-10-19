import { Lock, Unlock, Cloud, CloudCheck, CloudAlert, CloudOff, EthernetPort, Unplug } from "lucide-react";
import DigitalClock from "./clock";
import DriveModeIndicator from "./drive-mode-indicator";
import BatteryIndicator from "./battery-indicator";
import { useStore } from "@/stores/useStore";
import { useShallow } from "zustand/react/shallow";
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { overall } from "@/services/kart-agent/health";
import { IncomingPacket } from "@/data/zonecontrollers/packets";
import { BatteryCommands } from "@/data/zonecontrollers/zonecontrollers";
import log from "@/lib/logger";

export const HeaderBar = () => {

    const navigate = useNavigate();
    const telemetry = useStore((state) => overall(state.kartAgentStatus, state.kartAgentError));
    const { adminMode, batteryPercentage, setBatteryVoltage, gokartLanConnected } = useStore(
        useShallow((state) => ({
            adminMode: state.adminMode,
            batteryPercentage: state.batteryPercentage,
            setBatteryVoltage: state.setBatteryVoltage,
            gokartLanConnected: state.gokartLanConnected,
        }))
    );

    useEffect(() => {
        const cleanup = window.sero.onBatteryMessage((incomingPacket: string) => {
          log.debug("Received incoming battery message header-bar.tsx");
          const parsed: IncomingPacket = JSON.parse(incomingPacket);
          switch(parsed.command) {
            case BatteryCommands.GET_VOLTAGE:
                setBatteryVoltage(parsed.value);
                break;
          }
        });
        return cleanup;
    }, []);

    return (
        <div className="flex flex-row items-center justify-between px-2 py-1">
            <div className="flex flex-row items-center gap-4 min-w-28">
                <DriveModeIndicator />
                <div className="flex flex-row items-center gap-2 text-muted-foreground">
                    {gokartLanConnected ? <EthernetPort className="w-6 h-6 text-green-500" /> : <Unplug className="w-6 h-6 text-red-500" />}
                    {/* Telemetry: red when nothing is recorded, otherwise the pit wall uplink. */}
                    <button type="button" aria-label="Telemetry" className="-m-2 p-2" onClick={() => navigate("/telemetry")}>
                        {telemetry === "ok" && <CloudCheck className="w-6 h-6 text-green-500" />}
                        {telemetry === "warn" && <CloudAlert className="w-6 h-6 text-yellow-500" />}
                        {telemetry === "fault" && <CloudAlert className="w-6 h-6 text-red-500" />}
                        {telemetry === "off" && <CloudOff className="w-6 h-6" />}
                        {telemetry === "unknown" && <Cloud className="w-6 h-6" />}
                    </button>
                </div>
            </div>
            <DigitalClock />
            <div className="flex min-w-28 justify-end items-center">
            { adminMode ? <Unlock className="w-6 h-6 mr-3 text-red" /> : <Lock className="w-6 h-6 mr-3" /> }
            <BatteryIndicator batteryLevel={batteryPercentage*100} />
            </div>
        </div>
    );
}