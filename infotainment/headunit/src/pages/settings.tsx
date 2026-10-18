import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useStore } from "@/stores/useStore";
import { useShallow } from "zustand/react/shallow";
import { DriveModes } from "@/data/controlling_models/drivetrain";
import { HeaderBar } from "@/components/shared/header-bar";
import { toast } from "sonner";
import AdvancedSettingsDialog from "@/components/shared/advanced-settings/advanced-settings-dialog";
import AdminSettingsDialog from "@/components/admin-mode/admin-settings-dialog";
import React, { useEffect, useState } from "react";
import PowerMenu from "@/components/power-menu/power-menu";
import log, { setRendererLogLevel, type LogLevel } from "@/lib/logger";
import { AnalyticsBackendDialog } from "@/components/settings/analytics-backend-dialog";
import { AppUpdateDialog } from "@/components/settings/app-update-dialog";
import { AdminAuthDialog } from "@/components/admin-mode/admin-auth-dialog";
import { NetworkInterfaceDialog } from "@/components/settings/network-interface-dialog";
import { useNavigate } from "react-router-dom";
import { Lock, RefreshCw, Unlock } from "lucide-react";

const SettingsPage = () => {
  const {
    driveMode,
    speedLimit,
    minSettableSpeed,
    maxSettableSpeed,
    appVersion,
    analyticsEnabled,
    logLevel,
    adminMode,
    autoStart,
    fullscreenOnStartup,
    devToolsEnabled,
    setDriveMode,
    setSpeedLimit,
    setAppVersion,
    setAnalyticsEnabled,
    setLogLevel,
    setAdminMode,
    setAdminPin,
    setAutoStart,
    setFullscreenOnStartup,
    setDevToolsEnabled,
  } = useStore(
    useShallow((state) => ({
      driveMode: state.driveMode,
      speedLimit: state.speedLimit,
      minSettableSpeed: state.minSettableSpeed,
      maxSettableSpeed: state.maxSettableSpeed,
      appVersion: state.appVersion,
      analyticsEnabled: state.analyticsEnabled,
      logLevel: state.logLevel,
      adminMode: state.adminMode,
      autoStart: state.autoStart,
      fullscreenOnStartup: state.fullscreenOnStartup,
      devToolsEnabled: state.devToolsEnabled,
      setDriveMode: state.setDriveMode,
      setSpeedLimit: state.setSpeedLimit,
      setAppVersion: state.setAppVersion,
      setAnalyticsEnabled: state.setAnalyticsEnabled,
      setLogLevel: state.setLogLevel,
      setAdminMode: state.setAdminMode,
      setAdminPin: state.setAdminPin,
      setAutoStart: state.setAutoStart,
      setFullscreenOnStartup: state.setFullscreenOnStartup,
      setDevToolsEnabled: state.setDevToolsEnabled,
    }))
  );

  const navigate = useNavigate();
  const [liveSpeed, setLiveSpeed] = useState(speedLimit);

  useEffect(() => {
    setLiveSpeed(speedLimit);
  }, [speedLimit]);

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
    const fetchAutoStart = async () => {
      try {
        const enabled = await window.app.getAutoStart();
        setAutoStart(enabled);
      } catch (e) {
        log.error(e);
      }
    };
    const fetchFullscreenOnStartup = async () => {
      try {
        const enabled = await window.app.getFullscreenOnStartup();
        setFullscreenOnStartup(enabled);
      } catch (e) {
        log.error(e);
      }
    };
    const fetchDevToolsEnabled = async () => {
      try {
        const enabled = await window.app.getDevToolsEnabled();
        setDevToolsEnabled(enabled);
      } catch (e) {
        log.error(e);
      }
    };
    fetchAppVersion();
    fetchLogLevel();
    fetchAutoStart();
    fetchFullscreenOnStartup();
    fetchDevToolsEnabled();
  }, [setAppVersion, setLogLevel, setAutoStart, setFullscreenOnStartup, setDevToolsEnabled]);

  const handleToggleAnalytics = (enabled: boolean) => {
    window.app.toggleAnalytics(enabled).then((result) => {
      setAnalyticsEnabled(result);
      toast(`Cloud Analytics ${result ? "enabled" : "disabled"}!`);
    });
  };


  const handleLogLevelChange = async (level: LogLevel) => {
    setLogLevel(level);
    setRendererLogLevel(level);
    await window.app.setLogLevel(level);
    toast(`Log level set to ${level}`);
    log.info(`Log level changed to: ${level}`);
  };

  const handleAdminLogout = () => {
    setAdminMode(false);
    setAdminPin("");
    toast("Admin mode disabled!");
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="sticky top-0 z-10 bg-background">
        <HeaderBar />
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col">

      <div className="flex flex-col px-8 py-3 gap-y-0.5 flex-1">

        {/* ── Driver Controls ── */}
        <p className="text-xs uppercase tracking-widest text-muted-foreground pb-1 pt-2">Driver Controls</p>
        <Separator />

        {/* Drive Mode */}
        <div className="flex flex-row items-center justify-between min-h-13">
          <Label className="text-base">Drive Mode</Label>
          <ToggleGroup
            type="single"
            value={driveMode}
            onValueChange={(v) => { if (v) setDriveMode(v as DriveModes); }}
          >
            <ToggleGroupItem value={DriveModes.eco} className="h-10 px-5">Eco</ToggleGroupItem>
            <ToggleGroupItem value={DriveModes.comfort} className="h-10 px-5">Comfort</ToggleGroupItem>
            <ToggleGroupItem value={DriveModes.sport} className="h-10 px-5">Sport</ToggleGroupItem>
            <ToggleGroupItem value={DriveModes.ludicrous} className="h-10 px-5">Ludicrous</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Separator />

        {/* Max Speed */}
        <div className="flex flex-col gap-y-2 py-3">
          <div className="flex flex-row items-center justify-between">
            <Label className="text-base">Max Speed</Label>
            <span className="text-2xl font-mono font-semibold tabular-nums">
              {liveSpeed} <span className="text-sm font-sans font-normal text-muted-foreground">km/h</span>
            </span>
          </div>
          <Slider
            value={[liveSpeed]}
            onValueChange={(v) => setLiveSpeed(v[0])}
            onValueCommit={(v) => setSpeedLimit(Number(v))}
            min={minSettableSpeed}
            max={maxSettableSpeed}
            step={1}
          />
        </div>

        <Separator />

        {/* Cloud Analytics */}
        <div className="flex flex-row items-center justify-between min-h-13">
          <Label htmlFor="analytics-enabled" className="text-base">Cloud Analytics</Label>
          <Switch
            id="analytics-enabled"
            checked={analyticsEnabled}
            onCheckedChange={handleToggleAnalytics}
          />
        </div>

        <Separator />

        {/* Telemetry (kart-agent) */}
        <div className="flex flex-row items-center justify-between min-h-13">
          <Label className="text-base">Telemetry</Label>
          <Button variant="outline" onClick={() => navigate("/telemetry")}>
            Open
          </Button>
        </div>

        <Separator />

        {/* Network Interface */}
        <div className="flex flex-row items-center justify-between min-h-13">
          <Label className="text-base">Network Interface</Label>
          <NetworkInterfaceDialog trigger={<Button variant="outline">Configure</Button>} />
        </div>

        <Separator />

        {/* Power Menu */}
        <div className="flex flex-row items-center justify-between min-h-13">
          <Label className="text-base">Power Menu</Label>
          <PowerMenu />
        </div>



        {/* ── Access / Admin Mode ── */}
        <p className="text-xs uppercase tracking-widest text-muted-foreground pb-1 pt-5">Access</p>
        <Separator />

        <div className="flex flex-row items-center justify-between min-h-13">
          <div className="flex items-center gap-2">
            {adminMode ? (
              <Unlock className="w-4 h-4 text-emerald-400" />
            ) : (
              <Lock className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-base">Admin Mode</span>
            {adminMode && (
              <Badge variant="outline" className="text-emerald-400 border-emerald-400 text-xs ml-1">
                Active
              </Badge>
            )}
          </div>
          {!adminMode ? (
            <AdminAuthDialog trigger={<Button variant="outline">Authenticate</Button>} />
          ) : (
            <Button variant="outline" onClick={handleAdminLogout}>
              <Lock className="w-4 h-4 mr-2" />
              Lock
            </Button>
          )}
        </div>

        {/* ── Engineer Panel (admin only) ── */}
        {adminMode && (
          <>
            <p className="text-xs uppercase tracking-widest text-muted-foreground pb-1 pt-5">
              Engineer Settings
            </p>
            <Separator />

            {/* Log Level */}
            <div className="flex flex-row items-center justify-between min-h-13">
              <Label className="text-base">Log Level</Label>
              <Tabs value={logLevel} onValueChange={(v) => handleLogLevelChange(v as LogLevel)}>
                <TabsList>
                  <TabsTrigger value="error">Error</TabsTrigger>
                  <TabsTrigger value="warn">Warn</TabsTrigger>
                  <TabsTrigger value="info">Info</TabsTrigger>
                  <TabsTrigger value="debug">Debug</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <Separator />

            {/* Analytics Backend */}
            <div className="flex flex-row items-center justify-between min-h-13">
              <Label className="text-base">Analytics Backend</Label>
              <AnalyticsBackendDialog trigger={<Button variant="outline">Configure</Button>} />
            </div>

            <Separator />

            {/* Advanced Settings */}
            <div className="flex flex-row items-center justify-between min-h-13">
              <Label className="text-base">Advanced Settings</Label>
              <AdvancedSettingsDialog trigger={<Button variant="outline">Configure</Button>} />
            </div>

            <Separator />

            {/* Admin Settings */}
            <div className="flex flex-row items-center justify-between min-h-13">
              <Label className="text-base">Admin Settings</Label>
              <AdminSettingsDialog trigger={<Button variant="outline">Configure</Button>} />
            </div>

            <Separator />

            {/* ECU Manager */}
            <div className="flex flex-row items-center justify-between min-h-13">
              <Label className="text-base">ECU Manager</Label>
              <Button variant="outline" onClick={() => navigate("/ecu-manager")}>
                Open
              </Button>
            </div>

            <Separator />

            {/* App Update */}
            <div className="flex flex-row items-center justify-between min-h-13">
              <Label className="text-base">App Update</Label>
              <AppUpdateDialog
                trigger={
                  <Button variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Update
                  </Button>
                }
              />
            </div>
          </>
        )}
      </div>

      <div className="flex justify-center py-3 text-lg text-muted-foreground">
        Release {appVersion}
      </div>
    </div>
    </div>
  );
};

export default SettingsPage;
