import { Link } from "@tanstack/react-router";
// Links keep the current search (`?window=`) when switching views.
import type { ReactNode } from "react";
import { BatteryIcon, GaugeIcon, OverviewIcon, ThermometerIcon, TrackIcon } from "./icons";

const ITEMS = [
    { to: "/kart/$kartId", label: "Overview", icon: <OverviewIcon /> },
    { to: "/kart/$kartId/battery", label: "Battery", icon: <BatteryIcon /> },
    { to: "/kart/$kartId/drivetrain", label: "Drivetrain", icon: <GaugeIcon /> },
    { to: "/kart/$kartId/thermal", label: "Thermal", icon: <ThermometerIcon /> },
    { to: "/kart/$kartId/track", label: "Track", icon: <TrackIcon /> },
] as const satisfies readonly { to: string; label: string; icon: ReactNode }[];

/** Tabs from tablet width up. */
export function PresetTabs({ kartId }: { kartId: string }) {
    return (
        <nav role="tablist" className="tabs tabs-border hidden md:flex" aria-label="Views">
            {ITEMS.map((item) => (
                <Link
                    key={item.to}
                    to={item.to}
                    params={{ kartId }}
                    search={(prev) => prev}
                    role="tab"
                    className="tab"
                    activeOptions={{ exact: true, includeSearch: false }}
                    activeProps={{ className: "tab-active", "aria-selected": true }}
                >
                    {item.label}
                </Link>
            ))}
        </nav>
    );
}

/** Bottom navigation on phones. */
export function PresetDock({ kartId }: { kartId: string }) {
    return (
        <nav className="dock dock-sm md:hidden" aria-label="Views">
            {ITEMS.map((item) => (
                <Link
                    key={item.to}
                    to={item.to}
                    params={{ kartId }}
                    search={(prev) => prev}
                    activeOptions={{ exact: true, includeSearch: false }}
                    activeProps={{ className: "dock-active", "aria-current": "page" }}
                >
                    {item.icon}
                    <span className="dock-label">{item.label}</span>
                </Link>
            ))}
        </nav>
    );
}
