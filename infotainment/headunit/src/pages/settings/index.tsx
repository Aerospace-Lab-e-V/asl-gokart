import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useApp } from "@/stores/app";
import { useAgent } from "@/stores/agent";
import { useSession } from "@/stores/session";
import { app } from "@/services/app";
import { admin } from "@/services/admin";
import { hardware } from "@/services/hardware";
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
} from "@/components/settings/settings-list";

const DRIVE_MODES = [
  { value: DriveModes.eco, label: "Eco" },
  { value: DriveModes.comfort, label: "Comfort" },
  { value: DriveModes.sport, label: "Sport" },
  { value: DriveModes.ludicrous, label: "Ludicrous" },
];

/**
 * TODO(firmware): no ECU supports drive modes. Not mounted until one does; then send a command
 * and show the ECU's echo instead of this local state.
 */
export const DriveModeRow = () => {
  const [driveMode, setDriveMode] = useState(DriveModes.comfort);
  return (
    <SettingsRow icon={Zap} title="Drive mode">
      <SegmentedControl label="Drive mode" value={driveMode} options={DRIVE_MODES} onValueChange={setDriveMode} />
    </SettingsRow>
  );
};

const SettingsPage = () => {
  const appVersion = useApp((state) => state.version);
  const adminMode = useSession((state) => state.adminMode);
  const uplinkState = useAgent((state) =>
    state.error ? "Not running" : state.status ? uplink(state.status).state : ""
  );
  const [logLevel, setLogLevel] = useState<LogLevel | null>(null);
  const [networkInterface, setNetworkInterface] = useState("");

  useEffect(() => {
    const fetchLogLevel = async () => {
      try {
        const level = await app.getLogLevel();
        setLogLevel(level);
        setRendererLogLevel(level);
      } catch (e) {
        log.error(e);
      }
    };
    const fetchNetworkInterface = async () => {
      try {
        const current = await hardware.getNetworkInterface();
        setNetworkInterface(current?.name ?? "All interfaces");
      } catch (e) {
        log.error(e);
      }
    };
    fetchLogLevel();
    fetchNetworkInterface();
  }, []);

  // Main pushes the locked state to the session store.
  const handleAdminLogout = async () => {
    try {
      await admin.lock();
      toast("Admin mode disabled!");
    } catch (e) {
      log.error(e);
      toast.error(`Could not lock: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <HeaderBar />

      <div className="flex-1 overflow-y-auto px-8">
        {/* TODO(firmware): zc_throttle WebSocket path removed; re-add the Driver section with the
            "Max speed" slider when settings move to Sero. Drive mode: see DriveModeRow. */}

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
            <SettingsLinkRow to="/settings/drivetrain" icon={Cog} title="Drivetrain" />
            <SettingsLinkRow to="/settings/system" icon={AppWindow} title="System" value={logLevel && `Log level: ${logLevel}`} />
            <SettingsLinkRow to="/ecu-manager" icon={CircuitBoard} title="ECU Manager" />
            <SettingsLinkRow to="/settings/update" icon={Download} title="App update" value={appVersion && `v${appVersion}`} />
          </SettingsSection>
        )}

        <p className="text-muted-foreground py-6 text-center text-base">Release {appVersion ?? "unknown"}</p>
      </div>
    </div>
  );
};

export default SettingsPage;
