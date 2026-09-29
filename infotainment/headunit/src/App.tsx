import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { syncThemeWithLocal } from "./helpers/theme-helpers";
import { useTranslation } from "react-i18next";
import "./localization/i18n";
import { updateAppLanguage } from "./helpers/language-helpers";
import { Routes, Route, HashRouter } from "react-router-dom";
import { Battery, Car, Gauge, LifeBuoy, Radio, Settings } from "lucide-react";
import { NavBarItemData } from "./data/models";
import NavBar from "./components/navbar/navbar";
import DriveNormalPage from "./pages/drive-normal";
import SettingsPage from "./pages/settings";
import CarPage from "./pages/car";
import BatteryPage from "./pages/battery";
import EcuManagerPage from "./pages/ecu-manager";
import TinybufPage from "./pages/tinybuf";
import { Toaster } from "@/components/ui/sonner";
import MotorPage from "./pages/motor";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { useMotorData } from "./hooks/useMotorData";
import { useThrottleData } from "./hooks/useThrottleData";
import { useBatteryData } from "./hooks/useBatteryData";
import { useLightsData } from "./hooks/useLightsData";
import { useConnectionData } from "./hooks/useConnectionData";
import { initHardwareCommandSubscriber } from "./services/hardware-command-subscriber";
import NetworkGateScreen from "./components/shared/network-gate-screen";

function MainAppContent() {
    const { i18n } = useTranslation();

    useMotorData();
    useThrottleData();
    useBatteryData();
    useLightsData();
    useConnectionData();

    useEffect(() => {
        syncThemeWithLocal();
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
            Icon: Radio,
            label: "Tinybuf",
            linkTo: "/tinybuf",
        },
        {
            Icon: Settings,
            label: "Settings",
            linkTo: "/settings",
        },
    ];

    return (
        <div className="flex h-full w-full flex-row">
            <div className="flex-1">
                <>
                    <Routes>
                        <Route
                            path="/"
                            element={
                                <ErrorBoundary>
                                    <DriveNormalPage />
                                </ErrorBoundary>
                            }
                        />
                        <Route
                            path="/motor"
                            element={
                                <ErrorBoundary>
                                    <MotorPage />
                                </ErrorBoundary>
                            }
                        />
                        <Route
                            path="/car"
                            element={
                                <ErrorBoundary>
                                    <CarPage />
                                </ErrorBoundary>
                            }
                        />
                        <Route
                            path="/settings"
                            element={
                                <ErrorBoundary>
                                    <SettingsPage />
                                </ErrorBoundary>
                            }
                        />
                        <Route
                            path="/battery"
                            element={
                                <ErrorBoundary>
                                    <BatteryPage />
                                </ErrorBoundary>
                            }
                        />
                        <Route
                            path="/ecu-manager"
                            element={
                                <ErrorBoundary>
                                    <EcuManagerPage />
                                </ErrorBoundary>
                            }
                        />
                        <Route
                            path="/tinybuf"
                            element={
                                <ErrorBoundary>
                                    <TinybufPage />
                                </ErrorBoundary>
                            }
                        />
                    </Routes>
                </>
            </div>
            {
                <div className="w-20 border-l-2">
                    <NavBar items={navBarItems} />
                </div>
            }
            <Toaster />
        </div>
    );
}

export default function App() {
    const [networkReady, setNetworkReady] = useState<boolean | null>(null);

    useEffect(() => {
        // Query initial network readiness
        window.app.isNetworkReady().then((ready) => {
            setNetworkReady(ready);
        });

        // Listen for network gate readiness updates
        const unsubscribe = window.app.onNetworkStatusChange((status) => {
            setNetworkReady(status.ready);
        });

        return unsubscribe;
    }, []);

    if (networkReady === null) {
        // Blanks render while fetching status, preventing flash of gate screen
        return <div className="h-full min-h-screen w-full bg-slate-950" />;
    }

    if (!networkReady) {
        return <NetworkGateScreen />;
    }

    return <MainAppContent />;
}

const root = createRoot(document.getElementById("root")!);
root.render(
    <HashRouter>
        <App />
    </HashRouter>
);
