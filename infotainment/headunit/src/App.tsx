import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { syncThemeWithLocal } from "./services/theme";
import { useTranslation } from "react-i18next";
import "./localization/i18n";
import { updateAppLanguage } from "./helpers/language-helpers";
import { Routes, Route, HashRouter, Navigate } from "react-router-dom";
import { Battery, Car, Gauge, LifeBuoy, Settings } from "lucide-react";
import { NavBarItemData } from "./data/models";
import NavBar from "./components/navbar/navbar";
import DrivePage from "./pages/drive";
import SettingsPage from "./pages/settings";
import CarPage from "./pages/car";
import BatteryPage from "./pages/battery";
import EcuManagerPage from "./pages/ecu-manager";
import EcuControllerPage from "./pages/ecu-controller";
import TelemetryPage from "./pages/telemetry";
import NetworkInterfacePage from "./pages/settings/network";
import PowerPage from "./pages/settings/power";
import AdminUnlockPage from "./pages/settings/admin-unlock";
import DrivetrainPage from "./pages/settings/drivetrain";
import SystemPage from "./pages/settings/system";
import AppUpdatePage from "./pages/settings/app-update";
import { setDriveStylePickerOpen, useSession } from "@/stores/session";
import { Toaster } from "@/components/ui/sonner"
import MotorPage from "./pages/motor";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { BuildWatermark } from "@/components/shared/build-watermark";
import NetworkGateScreen from "./components/shared/network-gate-screen";
import type { NetworkGateStatus } from "./helpers/ipc/network-gate";
import { networkGate } from "./services/app";

/** Sends back to Settings when admin mode is locked. */
function AdminOnly({ children }: { children: React.ReactNode }) {
    const adminMode = useSession((state) => state.adminMode);
    return adminMode ? <>{children}</> : <Navigate to="/settings" replace />;
}

function MainAppContent() {
    const { i18n } = useTranslation();

    // Telemetry ingestion runs in services/bridge.ts, started once in renderer.ts.
    useEffect(() => {
        updateAppLanguage(i18n);
    }, []);

    const navBarItems: NavBarItemData[] = [
        {
            Icon: Gauge,
            label: "Drive",
            linkTo: "/",
            // Tapping Drive again picks the drive style.
            onReselect: () => setDriveStylePickerOpen(true),
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
                            <Route path="/" element={<ErrorBoundary><DrivePage /></ErrorBoundary>} />
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
                            <Route path="/ecu-manager/:id" element={<ErrorBoundary><AdminOnly><EcuControllerPage /></AdminOnly></ErrorBoundary>} />
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

/** Screen time of the boot splash, counted from when the window started loading. */
const SPLASH_MIN_MS = 1200;
/** Matches the splash fade-out in global.css. */
const SPLASH_FADE_MS = 500;

export default function App() {
    const [gate, setGate] = useState<NetworkGateStatus | null>(null);
    const [themeReady, setThemeReady] = useState(false);
    const [splashShown, setSplashShown] = useState(false);

    useEffect(() => {
        // Synced here, not in MainAppContent, so the gate screen follows the theme too
        syncThemeWithLocal().finally(() => setThemeReady(true));
        // An update that arrives before the initial status is newer, so it wins
        networkGate.getStatus().then((status) => setGate((current) => current ?? status));
        const timer = setTimeout(() => setSplashShown(true), SPLASH_MIN_MS - performance.now());
        const unsubscribe = networkGate.onStatus(setGate);
        return () => {
            clearTimeout(timer);
            unsubscribe();
        };
    }, []);

    // The first screen mounts as the splash fades, so its own fade-in plays in view instead of under the splash
    const loading = !themeReady || gate === null || !splashShown;

    // Fades out the boot splash from index.html once the first real screen can render.
    useEffect(() => {
        const splash = document.getElementById("splash");
        if (loading || !splash) return;
        splash.dataset.done = "";
        // A timer, as transitionend never fires in a window that isn't painting.
        setTimeout(() => splash.remove(), SPLASH_FADE_MS);
    }, [loading]);

    if (loading) {
        // Blank under the splash while fetching theme and status, preventing a flash of the wrong screen or theme
        return <div className="bg-background h-full w-full" />;
    }

    return (
        <>
            {gate.ready ? <MainAppContent /> : <NetworkGateScreen status={gate} />}
            <BuildWatermark />
        </>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(
    <HashRouter>
        <App />
    </HashRouter>
);
