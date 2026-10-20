import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Power, SkipForward, LucideIcon } from "lucide-react";
import type { GateInterface, NetworkGateStatus } from "@/helpers/ipc/network-gate";
import { AslLogo } from "@/components/shared/asl-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** After this long the crew gets a hint that something is wrong. */
const SLOW_AFTER_MS = 30_000;
/** How long Skip and Quit stay armed after the first tap, same as on the Power page. */
const CONFIRM_MS = 3000;
const PANEL_ID = "network-gate-engineer-info";

/**
 * Shown on boot until the car network interface is up. Drivers and pit crew only see the logo
 * and a status line; the engineer info with diagnostics, Skip and Quit opens from the bottom.
 */
export default function NetworkGateScreen({ status }: { status: NetworkGateStatus }) {
    const [engineerOpen, setEngineerOpen] = useState(false);
    const now = useNow();
    const slow = now - status.waitingSince > SLOW_AFTER_MS;

    return (
        <main className="bg-background text-foreground relative flex h-full w-full flex-col items-center justify-center overflow-hidden">
            {/* Moves up and shrinks so the status stays visible above the open engineer info */}
            <div
                className={cn(
                    "flex flex-col items-center gap-10 px-8 text-center",
                    "transition-transform duration-300 ease-out motion-reduce:transition-none",
                    engineerOpen && "-translate-y-36 scale-75"
                )}
            >
                <AslLogo className="h-28 w-auto" />

                <div className="flex flex-col items-center gap-3">
                    <h1 className="text-3xl font-semibold">Connecting to car</h1>
                    <p className="text-muted-foreground text-lg" aria-live="polite">
                        {slow
                            ? "Taking longer than usual. Check the car network cable."
                            : "The dashboard starts automatically once the car network is up."}
                    </p>
                </div>

                <div
                    role="progressbar"
                    aria-label="Connecting to car"
                    className="bg-muted h-1 w-56 overflow-hidden rounded-full"
                >
                    <div className="bg-foreground/70 animate-indeterminate h-full w-1/3 rounded-full motion-reduce:animate-none" />
                </div>
            </div>

            <Button
                variant="ghost"
                className="text-muted-foreground absolute bottom-4 h-12 gap-2 px-6 text-base"
                aria-expanded={engineerOpen}
                aria-controls={PANEL_ID}
                onClick={() => setEngineerOpen(true)}
            >
                Engineer info
                <ChevronUp className="h-5 w-5" aria-hidden />
            </Button>

            <EngineerPanel
                open={engineerOpen}
                onClose={() => setEngineerOpen(false)}
                status={status}
                now={now}
            />
        </main>
    );
}

/** Current time, updated every second. */
function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

type EngineerPanelProps = {
    open: boolean;
    onClose: () => void;
    status: NetworkGateStatus;
    now: number;
};

const EngineerPanel = ({ open, onClose, status, now }: EngineerPanelProps) => (
    <section
        id={PANEL_ID}
        aria-label="Engineer info"
        inert={!open}
        className={cn(
            "bg-background absolute inset-x-0 bottom-0 flex max-h-[75%] flex-col rounded-t-xl border-t shadow-lg",
            "transition-transform duration-300 ease-out motion-reduce:transition-none",
            open ? "translate-y-0" : "translate-y-full"
        )}
    >
        <div className="flex items-center justify-between py-2 pr-4 pl-8">
            <h2 className="text-xl font-semibold">Engineer info</h2>
            <Button
                variant="ghost"
                size="icon"
                className="h-12 w-12"
                aria-label="Close engineer info"
                onClick={onClose}
            >
                <ChevronDown className="h-7 w-7" aria-hidden />
            </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] gap-x-10 overflow-y-auto px-8 pb-4">
            <dl className="grid grid-cols-[auto_auto] content-start gap-x-6 gap-y-2 text-base">
                <dt className="text-muted-foreground">Looking for</dt>
                <dd className="tabular-nums">{status.mac ?? "—"}</dd>
                <dt className="text-muted-foreground">Waiting</dt>
                <dd className="tabular-nums">{formatDuration(now - status.waitingSince)}</dd>
                <dt className="text-muted-foreground">Last check</dt>
                <dd className="tabular-nums">
                    {status.lastCheck === null
                        ? "—"
                        : `${formatDuration(now - status.lastCheck)} ago`}
                </dd>
            </dl>

            <InterfaceTable interfaces={status.interfaces} mac={status.mac} />
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-8 py-3">
            <ConfirmButton
                icon={SkipForward}
                label="Skip network check"
                armedLabel="Tap again to skip"
                onConfirm={() => window.app.skipNetworkGate()}
            />
            <ConfirmButton
                icon={Power}
                label="Quit app"
                armedLabel="Tap again to quit"
                destructive
                onConfirm={() => window.electronWindow.close()}
            />
        </div>
    </section>
);

const InterfaceTable = ({
    interfaces,
    mac,
}: {
    interfaces: GateInterface[];
    mac: string | null;
}) => {
    if (interfaces.length === 0) {
        return <p className="text-muted-foreground text-base">No network interfaces found</p>;
    }

    return (
        <table className="w-full text-left text-base tabular-nums">
            <thead className="text-muted-foreground">
                <tr>
                    <th className="pb-1 font-normal">Interface</th>
                    <th className="pb-1 font-normal">MAC</th>
                    <th className="pb-1 font-normal">IPv4</th>
                </tr>
            </thead>
            <tbody>
                {interfaces.map((iface) => {
                    const isCarNetwork = iface.mac.toLowerCase() === mac?.toLowerCase();
                    return (
                        <tr key={iface.name} className={cn(isCarNetwork && "font-semibold")}>
                            <td className="py-1 pr-4">
                                {iface.name}
                                {isCarNetwork && (
                                    <span className="text-muted-foreground font-normal">
                                        {" "}
                                        (car)
                                    </span>
                                )}
                            </td>
                            <td className="py-1 pr-4">{iface.mac}</td>
                            <td className="py-1">{iface.ipv4 ?? "no address"}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};

type ConfirmButtonProps = {
    icon: LucideIcon;
    label: string;
    armedLabel: string;
    onConfirm: () => void;
    destructive?: boolean;
};

/** Needs a second tap within CONFIRM_MS, like "Close app" on the Power page. */
const ConfirmButton = ({
    icon: Icon,
    label,
    armedLabel,
    onConfirm,
    destructive,
}: ConfirmButtonProps) => {
    const [armed, setArmed] = useState(false);

    useEffect(() => {
        if (!armed) return;
        const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
        return () => clearTimeout(timer);
    }, [armed]);

    return (
        <button
            type="button"
            onClick={() => (armed ? onConfirm() : setArmed(true))}
            className={cn(
                "flex h-12 min-w-56 items-center justify-center gap-2 rounded-xl border-2 px-6 text-base font-medium transition-colors",
                "active:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                armed && !destructive && "border-foreground bg-foreground text-background",
                // Raw reds: the theme's destructive red is too dark to read on the dark background.
                destructive && "border-red-500/60 text-red-500",
                destructive && armed && "border-red-600 bg-red-600 text-white active:bg-red-700"
            )}
        >
            <Icon className="h-5 w-5" aria-hidden />
            <span aria-live="polite">{armed ? armedLabel : label}</span>
        </button>
    );
};

function formatDuration(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
