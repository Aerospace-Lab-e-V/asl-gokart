import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useStore } from "@/stores/useStore";
import { useShallow } from "zustand/react/shallow";
import { DriveModes } from "@/data/controlling_models/drivetrain";
import { HeaderBar } from "@/components/shared/header-bar";
import { toast } from "sonner";
import React, { useEffect, useState } from "react";
import log, { setRendererLogLevel, type LogLevel } from "@/lib/logger";
import {
  AppWindow,
  CircuitBoard,
  Cog,
  Download,
  EthernetPort,
  Gauge,
  Lock,
  Power,
  RadioTower,
  Unlock,
  Zap,
} from "lucide-react";
import { UplinkSwitch } from "@/components/telemetry/uplink-switch";
import { uplink } from "@/services/kart-agent/health";
import {
  SegmentedControl,
  SettingsLinkRow,
  SettingsRow,
  SettingsSection,
  SettingsSliderRow,
} from "@/components/settings/settings-list";

const DRIVE_MODES = [
  { value: DriveModes.eco, label: "Eco" },
  { value: DriveModes.comfort, label: "Comfort" },
  { value: DriveModes.sport, label: "Sport" },
  { value: DriveModes.ludicrous, label: "Ludicrous" },
];

const SettingsPage = () => {
  const {
    driveMode,
    speedLimit,
    minSettableSpeed,
    maxSettableSpeed,
    appVersion,
    logLevel,
    adminMode,
    setDriveMode,
    setSpeedLimit,
    setAppVersion,
    setLogLevel,
    setAdminMode,
    setAdminPin,
  } = useStore(
    useShallow((state) => ({
      driveMode: state.driveMode,
      speedLimit: state.speedLimit,
      minSettableSpeed: state.minSettableSpeed,
      maxSettableSpeed: state.maxSettableSpeed,
      appVersion: state.appVersion,
      logLevel: state.logLevel,
      adminMode: state.adminMode,
      setDriveMode: state.setDriveMode,
      setSpeedLimit: state.setSpeedLimit,
      setAppVersion: state.setAppVersion,
      setLogLevel: state.setLogLevel,
      setAdminMode: state.setAdminMode,
      setAdminPin: state.setAdminPin,
    }))
  );

  const uplinkState = useStore((state) =>
    state.kartAgentError ? "Not running" : state.kartAgentStatus ? uplink(state.kartAgentStatus).state : ""
  );
  const [networkInterface, setNetworkInterface] = useState("");

  useEffect(() => {
    const fetchAppVersion = async () => {
      try {
        const version = await window.app.getVersion();
        setAppVersion(version);
      } catch (e) {
        log.error(e);
      }
    };
    const fetchLogLevel = async () => {
      try {
        const level = (await window.app.getLogLevel()) as LogLevel;
        setLogLevel(level);
        setRendererLogLevel(level);
      } catch (e) {
        log.error(e);
      }
    };
    const fetchNetworkInterface = async () => {
      try {
        const current = await window.hardware.getNetworkInterface();
        setNetworkInterface(current?.name ?? "All interfaces");
      } catch (e) {
        log.error(e);
      }
    };
    fetchAppVersion();
    fetchLogLevel();
    fetchNetworkInterface();
  }, [setAppVersion, setLogLevel]);

  const handleAdminLogout = () => {
    setAdminMode(false);
    setAdminPin("");
    toast("Admin mode disabled!");
  };

  return (
    <div className="w-full h-full flex flex-col">
      <HeaderBar />

      <div className="flex-1 overflow-y-auto px-8">
        <SettingsSection title="Driver">
          <SettingsRow icon={Zap} title="Drive mode">
            <SegmentedControl label="Drive mode" value={driveMode} options={DRIVE_MODES} onValueChange={setDriveMode} />
          </SettingsRow>
          <SettingsSliderRow
            icon={Gauge}
            title="Max speed"
            unit="km/h"
            value={speedLimit}
            min={minSettableSpeed}
            max={maxSettableSpeed}
            step={1}
            onCommit={setSpeedLimit}
          />
        </SettingsSection>

        <SettingsSection title="System">
          {/* Telemetry (kart-agent): the row opens the details, the switch sends to the pit wall */}
          <div className="flex items-center pr-4">
            <SettingsLinkRow className="flex-1" to="/telemetry" icon={RadioTower} title="Telemetry" value={uplinkState} />
            <Separator orientation="vertical" className="h-10 mx-4" />
            {/* The label widens the switch's touch target without resizing it. */}
            <label className="-my-3 -mr-3 p-3">
              <UplinkSwitch />
            </label>
          </div>
          <SettingsLinkRow to="/settings/network" icon={EthernetPort} title="Network interface" value={networkInterface} />
          <SettingsLinkRow to="/settings/power" icon={Power} title="Power" description="Minimize, maximize or close the app" />
        </SettingsSection>

        <SettingsSection title="Access">
          {adminMode ? (
            <SettingsRow icon={Unlock} title="Admin mode" description="Engineer settings are unlocked">
              <Button variant="outline" className="h-12 px-6 text-lg" onClick={handleAdminLogout}>
                <Lock className="mr-2 h-5 w-5" />
                Lock
              </Button>
            </SettingsRow>
          ) : (
            <SettingsLinkRow to="/settings/unlock" icon={Lock} title="Admin mode" value="Locked" />
          )}
        </SettingsSection>

        {adminMode && (
          <SettingsSection title="Engineer">
            <SettingsLinkRow
              to="/settings/drivetrain"
              icon={Cog}
              title="Drivetrain"
              value={`${minSettableSpeed}–${maxSettableSpeed} km/h`}
            />
            <SettingsLinkRow to="/settings/system" icon={AppWindow} title="System" value={`Log level: ${logLevel}`} />
            <SettingsLinkRow to="/ecu-manager" icon={CircuitBoard} title="ECU Manager" />
            <SettingsLinkRow to="/settings/update" icon={Download} title="App update" value={`v${appVersion}`} />
          </SettingsSection>
        )}

        <p className="text-muted-foreground py-6 text-center text-base">Release {appVersion}</p>
      </div>
    </div>
  );
};

export default SettingsPage;
