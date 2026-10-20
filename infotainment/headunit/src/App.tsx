import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { syncThemeWithLocal } from "./helpers/theme-helpers";
import { useTranslation } from "react-i18next";
import "./localization/i18n";
import { updateAppLanguage } from "./helpers/language-helpers";
import { Routes, Route, HashRouter, Navigate } from "react-router-dom";
import { Battery, Car, Gauge, LifeBuoy, Settings } from "lucide-react";
import { NavBarItemData } from "./data/models";
import NavBar from "./components/navbar/navbar";
import DriveNormalPage from "./pages/drive-normal";
import SettingsPage from "./pages/settings";
import CarPage from "./pages/car";
import BatteryPage from "./pages/battery";
import EcuManagerPage from "./pages/ecu-manager";
import TelemetryPage from "./pages/telemetry";
import NetworkInterfacePage from "./pages/settings/network";
import PowerPage from "./pages/settings/power";
import AdminUnlockPage from "./pages/settings/admin-unlock";
import DrivetrainPage from "./pages/settings/drivetrain";
import SystemPage from "./pages/settings/system";
import AppUpdatePage from "./pages/settings/app-update";
import { useStore } from "@/stores/useStore";
import { Toaster } from "@/components/ui/sonner"
import MotorPage from "./pages/motor";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { useMotorData } from "./hooks/useMotorData";
import { useThrottleData } from "./hooks/useThrottleData";
import { useBatteryData } from "./hooks/useBatteryData";
import { useLightsData } from "./hooks/useLightsData";
import { useConnectionData } from "./hooks/useConnectionData";
import { useKartAgentData } from "./hooks/useKartAgentData";
import { initHardwareCommandSubscriber } from "./services/hardware-command-subscriber";
import NetworkGateScreen from "./components/shared/network-gate-screen";
import type { NetworkGateStatus } from "./helpers/ipc/network-gate";

/** Sends back to Settings when admin mode is locked. */
function AdminOnly({ children }: { children: React.ReactNode }) {
    const adminMode = useStore((state) => state.adminMode);
    return adminMode ? <>{children}</> : <Navigate to="/settings" replace />;
}

function MainAppContent() {
    const { i18n } = useTranslation();

    useMotorData();
    useThrottleData();
    useBatteryData();
    useLightsData();
    useConnectionData();
    useKartAgentData();

    useEffect(() => {
        updateAppLanguage(i18n);
        const unsubHardwareCommands = initHardwareCommandSubscriber();
        return unsubHardwareCommands;
    }, []);

    const navBarItems: NavBarItemData[] = [
        {
            Icon: Gauge,
            label: "Drive",
            linkTo: "/",
        },
        {
            Icon: LifeBuoy,
            label: "Motor",
            linkTo: "/motor",
        },
        {
            Icon: Car,
            label: "Car",
            linkTo: "/car",
        },
        {
            Icon: Battery,
            label: "Battery",
            linkTo: "/battery",
        },
        {
            Icon: Settings,
            label: "Settings",
            linkTo: "/settings",
            alsoActiveOn: ["/telemetry", "/ecu-manager"],
        },
    ];

    return (
            <div className="flex flex-row w-full h-full">
                <div className="flex-1">
                    <>
                        <Routes>
                            <Route path="/" element={<ErrorBoundary><DriveNormalPage /></ErrorBoundary>} />
                            <Route path="/motor" element={<ErrorBoundary><MotorPage /></ErrorBoundary>} />
                            <Route path="/car" element={<ErrorBoundary><CarPage /></ErrorBoundary>} />
                            <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
                            <Route path="/battery" element={<ErrorBoundary><BatteryPage /></ErrorBoundary>} />
                            <Route path="/settings/network" element={<ErrorBoundary><NetworkInterfacePage /></ErrorBoundary>} />
                            <Route path="/settings/power" element={<ErrorBoundary><PowerPage /></ErrorBoundary>} />
                            <Route path="/settings/unlock" element={<ErrorBoundary><AdminUnlockPage /></ErrorBoundary>} />
                            <Route path="/settings/drivetrain" element={<ErrorBoundary><AdminOnly><DrivetrainPage /></AdminOnly></ErrorBoundary>} />
                            <Route path="/settings/system" element={<ErrorBoundary><AdminOnly><SystemPage /></AdminOnly></ErrorBoundary>} />
                            <Route path="/settings/update" element={<ErrorBoundary><AdminOnly><AppUpdatePage /></AdminOnly></ErrorBoundary>} />
                            <Route path="/ecu-manager" element={<ErrorBoundary><AdminOnly><EcuManagerPage /></AdminOnly></ErrorBoundary>} />
                            <Route path="/telemetry" element={<ErrorBoundary><TelemetryPage /></ErrorBoundary>} />
                        </Routes>
                    </>
                </div>
                {<div className="w-20 shrink-0 border-l">
                    <NavBar items={navBarItems} />
                </div>}
                <Toaster />
            </div>
    );
}

export default function App() {
    const [gate, setGate] = useState<NetworkGateStatus | null>(null);
    const [themeReady, setThemeReady] = useState(false);

    useEffect(() => {
        // Synced here, not in MainAppContent, so the gate screen follows the theme too
        syncThemeWithLocal().finally(() => setThemeReady(true));
        // An update that arrives before the initial status is newer, so it wins
        window.app.getNetworkGateStatus().then((status) => setGate((current) => current ?? status));
        return window.app.onNetworkStatusChange(setGate);
    }, []);

    if (!themeReady || gate === null) {
        // Blank while fetching theme and status, preventing a flash of the wrong screen or theme
        return <div className="bg-background h-full w-full" />;
    }

    if (!gate.ready) {
        return <NetworkGateScreen status={gate} />;
    }

    return <MainAppContent />;
}

const root = createRoot(document.getElementById("root")!);
root.render(
    <HashRouter>
        <App />
    </HashRouter>
);
