import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronLeft, CloudOff, HardDrive, LucideIcon, Network, RadioTower, SlidersHorizontal, X } from "lucide-react";
import { HeaderBar } from "@/components/shared/header-bar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TelemetryConfigDialog } from "@/components/telemetry/telemetry-config-dialog";
import { UplinkSwitch } from "@/components/telemetry/uplink-switch";
import { useStore } from "@/stores/useStore";
import { AgentStatus } from "@/services/kart-agent/schema";
import { carNetwork, ecus, Line, recording, Tone, uplink } from "@/services/kart-agent/health";
import { cn } from "@/lib/utils";

/**
 * State of kart-agent, the service that records ECU data on the Pi and sends it to
 * the pit wall. Read at arm's length by the pit crew; the debug counters stay in its log.
 */
const TelemetryPage = () => {
    const navigate = useNavigate();
    const adminMode = useStore((state) => state.adminMode);
    const status = useStore((state) => state.kartAgentStatus);
    const error = useStore((state) => state.kartAgentError);

    return (
        <div className="flex h-full w-full flex-col">
            <HeaderBar />

            <div className="flex items-center gap-2 py-2 pr-8 pl-4">
                <Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Back" onClick={() => navigate(-1)}>
                    <ChevronLeft className="h-7 w-7" />
                </Button>
                <h1 className="text-2xl font-semibold">Telemetry</h1>
                {adminMode && (
                    <TelemetryConfigDialog
                        trigger={
                            <Button variant="outline" className="ml-auto h-12 px-6 text-base">
                                <SlidersHorizontal className="mr-2 h-5 w-5" />
                                Configure
                            </Button>
                        }
                    />
                )}
            </div>

            {error ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-12">
                    <CloudOff className="h-14 w-14 text-red-500" />
                    <p className="text-2xl font-medium">Telemetry is not running</p>
                    <p className="text-muted-foreground text-lg">Check the kart-agent service on the Pi</p>
                </div>
            ) : !status ? (
                <p className="text-muted-foreground flex flex-1 items-center justify-center pb-12 text-xl">Connecting…</p>
            ) : (
                <StatusList status={status} />
            )}
        </div>
    );
};

const StatusList = ({ status }: { status: AgentStatus }) => {
    const [showEcus, setShowEcus] = useState(false);

    return (
        <div className="flex-1 overflow-y-auto px-8">
            <Separator />
            <StatusRow icon={HardDrive} title="Recording" line={recording(status)} />
            <Separator />
            <StatusRow icon={RadioTower} title="Pit wall uplink" line={uplink(status)}>
                {/* The label widens the switch's touch target without resizing it. */}
                <label className="-my-3 -mr-3 p-3">
                    <UplinkSwitch />
                </label>
            </StatusRow>
            <Separator />
            <button
                type="button"
                className="w-full text-left"
                aria-expanded={showEcus}
                onClick={() => setShowEcus(!showEcus)}
            >
                <StatusRow icon={Network} title="Car network" line={carNetwork(status)}>
                    <ChevronDown
                        className={cn("text-muted-foreground h-6 w-6 transition-transform", showEcus && "rotate-180")}
                    />
                </StatusRow>
            </button>
            {showEcus && (
                <ul className="pb-3">
                    {ecus(status).map((ecu) => (
                        <li key={ecu.name} className="flex min-h-12 items-center gap-4 pr-10 pl-12 text-lg">
                            {ecu.name}
                            <span className="text-muted-foreground ml-auto">{ecu.note}</span>
                            {ecu.online ? (
                                <Check className="h-6 w-6 text-green-500" />
                            ) : (
                                <X className="h-6 w-6 text-red-500" />
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <Separator />
        </div>
    );
};

const TONE_TEXT: Record<Tone, string> = {
    ok: "",
    warn: "text-amber-600 dark:text-yellow-500",
    fault: "text-red-500",
    off: "text-muted-foreground",
};

const TONE_DOT: Record<Tone, string> = {
    ok: "bg-green-500",
    warn: "bg-yellow-500",
    fault: "bg-red-500",
    off: "bg-muted-foreground/40",
};

type StatusRowProps = { icon: LucideIcon; title: string; line: Line; children?: React.ReactNode };

const StatusRow = ({ icon: Icon, title, line, children }: StatusRowProps) => (
    <div className="flex min-h-20 items-center gap-5">
        <Icon className="text-muted-foreground h-7 w-7 shrink-0" />
        <span className="shrink-0 text-xl">{title}</span>
        <div className="ml-auto flex min-w-0 items-center gap-5">
            {line.detail && <span className="text-muted-foreground truncate text-lg">{line.detail}</span>}
            <span className={cn("flex shrink-0 items-center gap-2 text-xl font-medium", TONE_TEXT[line.tone])}>
                <span className={cn("h-3 w-3 rounded-full", TONE_DOT[line.tone])} aria-hidden />
                {line.state}
            </span>
            {children}
        </div>
    </div>
);

export default TelemetryPage;
