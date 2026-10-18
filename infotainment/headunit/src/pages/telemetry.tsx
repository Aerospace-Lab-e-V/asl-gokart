import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { HeaderBar } from "@/components/shared/header-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useKartAgentStatus } from "@/hooks/useKartAgentStatus";
import { getConfig, putConfig } from "@/services/kart-agent/client";
import { AgentConfig, AgentStatus, ConfigPatch } from "@/services/kart-agent/schema";
import { useStore } from "@/stores/useStore";
import { NetworkInterfaceFamily, parseNetworkInterfaces } from "@/lib/types/hardware";
import log from "@/lib/logger";

/**
 * Status and configuration of kart-agent, the telemetry service that logs ECU data on
 * the Pi and sends it to the pit wall. It runs independently of this app.
 */
const TelemetryPage = () => {
    const navigate = useNavigate();
    const adminMode = useStore((state) => state.adminMode);
    const { status, error } = useKartAgentStatus();

    return (
        <div className="flex h-full w-full flex-col">
            <HeaderBar />

            <div className="flex items-center gap-3 border-b px-4 py-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate("/settings")}
                    className="shrink-0"
                >
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                    <h1 className="text-base leading-tight font-semibold">Telemetry</h1>
                    <p className="text-muted-foreground text-xs">
                        kart-agent: local session log and live uplink to the pit wall
                    </p>
                </div>
            </div>

            <Separator />

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                {!status ? (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {error ? "kart-agent not reachable" : "Connecting to kart-agent…"}
                            </CardTitle>
                        </CardHeader>
                        {error && (
                            <CardContent className="text-muted-foreground space-y-1 text-sm">
                                <p>{error}</p>
                                <p>
                                    The service may be starting, stopped or not installed. On the
                                    Pi: <code>systemctl status kart-agent</code>
                                </p>
                            </CardContent>
                        )}
                    </Card>
                ) : (
                    <>
                        {error && (
                            <p className="text-sm text-amber-400">
                                Lost connection to kart-agent, showing the last status.
                            </p>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <UplinkCard status={status} adminMode={adminMode} />
                            <EcuCard status={status} />
                            <LogCard status={status} />
                            <SessionCard status={status} />
                        </div>
                        {adminMode ? (
                            <ConfigCard />
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                Unlock admin mode in Settings to change the configuration.
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex min-h-7 items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="truncate text-right font-mono">{children}</span>
    </div>
);

const StateBadge = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <Badge
        variant="outline"
        className={ok ? "border-emerald-400 text-emerald-400" : "border-amber-400 text-amber-400"}
    >
        {children}
    </Badge>
);

const UplinkCard = ({ status, adminMode }: { status: AgentStatus; adminMode: boolean }) => {
    const live = status.live;
    const [busy, setBusy] = useState(false);
    const state = !live.enabled
        ? "off"
        : !live.configured
          ? "no broker set"
          : live.connected
            ? "connected"
            : "connecting";

    const toggle = async (enabled: boolean) => {
        setBusy(true);
        try {
            await putConfig({ live: { enabled } });
            toast(`Live uplink ${enabled ? "enabled" : "disabled"}`);
        } catch (e) {
            log.error(e);
            toast.error(`Could not switch the uplink: ${e instanceof Error ? e.message : e}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">Live uplink</CardTitle>
                <StateBadge ok={state === "connected"}>{state}</StateBadge>
            </CardHeader>
            <CardContent>
                <Row label="Broker">{live.broker_url || "–"}</Row>
                <Row label="Batches sent">{live.published}</Row>
                <Row label="Dropped">{live.dropped}</Row>
                <div className="flex min-h-9 items-center justify-between pt-1">
                    <Label htmlFor="live-enabled" className="text-sm">
                        Send to pit wall
                    </Label>
                    <Switch
                        id="live-enabled"
                        checked={live.enabled}
                        disabled={!adminMode || busy}
                        onCheckedChange={toggle}
                    />
                </div>
            </CardContent>
        </Card>
    );
};

function ago(us: number | null): string {
    if (us === null) return "never";
    const s = Math.max(0, (Date.now() * 1000 - us) / 1e6);
    return s < 60 ? `${s.toFixed(0)} s ago` : `${(s / 60).toFixed(0)} min ago`;
}

const EcuCard = ({ status }: { status: AgentStatus }) => {
    const sero = status.sero;
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">ECUs</CardTitle>
                <StateBadge ok={sero.state === "running"}>
                    {sero.state.replace(/_/g, " ")}
                </StateBadge>
            </CardHeader>
            <CardContent>
                {sero.error && <p className="pb-1 text-xs text-amber-400">{sero.error}</p>}
                {sero.services.map((s) => {
                    const lastRx = Math.max(...s.events.map((e) => e.last_rx_us ?? 0));
                    const subscribed = s.events.every((e) => e.ack === 0);
                    return (
                        <Row key={s.id} label={s.name}>
                            {!s.found
                                ? "not found"
                                : `${subscribed ? "" : "subscribing, "}${ago(lastRx || null)}`}
                        </Row>
                    );
                })}
                <Row label="Interface">
                    {sero.interface}
                    {sero.address ? ` (${sero.address})` : ""}
                </Row>
            </CardContent>
        </Card>
    );
};

const megabytes = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

const LogCard = ({ status }: { status: AgentStatus }) => {
    const l = status.log;
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">Session log</CardTitle>
                <StateBadge ok={l.active_segment !== null && l.write_errors === 0}>
                    {l.active_segment ? "recording" : "idle"}
                </StateBadge>
            </CardHeader>
            <CardContent>
                <Row label="Size">
                    {megabytes(l.total_bytes)} in {l.segments} files
                </Row>
                <Row label="Free space">{(l.fs_free_bytes / 1e9).toFixed(1)} GB</Row>
                <Row label="Write errors">{l.write_errors}</Row>
                {l.last_error && <p className="pt-1 text-xs text-amber-400">{l.last_error}</p>}
            </CardContent>
        </Card>
    );
};

const SessionCard = ({ status }: { status: AgentStatus }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Session</CardTitle>
            <StateBadge ok={status.clock.synced}>
                {status.clock.synced ? "clock synced" : "clock not synced"}
            </StateBadge>
        </CardHeader>
        <CardContent>
            <Row label="Session">{status.session.id.slice(0, 8)}…</Row>
            <Row label="Batches">{status.session.next_seq}</Row>
            <Row label="Agent">
                {status.agent.version} (run {status.agent.runs})
            </Row>
            <Row label="Uptime">{Math.floor(status.agent.uptime_s / 60)} min</Row>
        </CardContent>
    </Card>
);

/** Fields of the form, as edited (strings for the inputs). */
type Form = {
    kart_id: string;
    broker_url: string;
    batch_ms: string;
    interface: string;
    client_id: string;
    port: string;
};

const toForm = (c: AgentConfig): Form => ({
    kart_id: c.kart_id,
    broker_url: c.live.broker_url,
    batch_ms: String(c.live.batch_ms),
    interface: c.sero.interface,
    client_id: `0x${c.sero.client_id.toString(16).padStart(4, "0")}`,
    port: String(c.sero.port),
});

/** The changed fields as a merge patch; `null` if a number does not parse. */
export function formPatch(saved: Form, edited: Form): ConfigPatch | null {
    const patch: ConfigPatch = {};
    const num = (s: string) => (s.trim() === "" ? NaN : Number(s.trim()));
    if (edited.kart_id !== saved.kart_id) patch.kart_id = edited.kart_id.trim();
    const live: NonNullable<ConfigPatch["live"]> = {};
    if (edited.broker_url !== saved.broker_url) live.broker_url = edited.broker_url.trim();
    if (edited.batch_ms !== saved.batch_ms) live.batch_ms = num(edited.batch_ms);
    const sero: NonNullable<ConfigPatch["sero"]> = {};
    if (edited.interface !== saved.interface) sero.interface = edited.interface.trim();
    if (edited.client_id !== saved.client_id) sero.client_id = num(edited.client_id);
    if (edited.port !== saved.port) sero.port = num(edited.port);
    if (Object.keys(live).length) patch.live = live;
    if (Object.keys(sero).length) patch.sero = sero;
    const numbers = [live.batch_ms, sero.client_id, sero.port].filter((n) => n !== undefined);
    return numbers.every((n) => Number.isInteger(n)) ? patch : null;
}

const ConfigCard = () => {
    const [saved, setSaved] = useState<Form | null>(null);
    const [form, setForm] = useState<Form | null>(null);
    const [interfaces, setInterfaces] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getConfig()
            .then((reply) => {
                setSaved(toForm(reply.effective));
                setForm(toForm(reply.effective));
            })
            .catch((e) => log.error(e));
        window.hardware
            .getAvailableNetworkInterfaces()
            .then((raw) => {
                const names = parseNetworkInterfaces(raw)
                    .filter((i) => i.family === NetworkInterfaceFamily.IPv4 && !i.internal)
                    .map((i) => i.name);
                setInterfaces([...new Set(names)]);
            })
            .catch((e) => log.error(e));
    }, []);

    if (!saved || !form) return null;
    const patch = formPatch(saved, form);
    const changed = patch !== null && Object.keys(patch).length > 0;
    const field = (key: keyof Form) => ({
        id: `cfg-${key}`,
        value: form[key],
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setForm({ ...form, [key]: e.target.value }),
    });

    const save = async () => {
        if (!patch) return;
        setSaving(true);
        try {
            const reply = await putConfig(patch);
            setSaved(toForm(reply.effective));
            setForm(toForm(reply.effective));
            toast(reply.restart_required ? "Saved, kart-agent is restarting…" : "Saved");
        } catch (e) {
            toast.error(`Not saved: ${e instanceof Error ? e.message : e}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div className="space-y-1">
                    <Label htmlFor="cfg-kart_id">Kart id</Label>
                    <Input {...field("kart_id")} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="cfg-broker_url">Broker (mqtt://host:port)</Label>
                    <Input {...field("broker_url")} placeholder="empty: no uplink" />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="cfg-interface">Car network interface</Label>
                    <Input {...field("interface")} list="cfg-interfaces" />
                    <datalist id="cfg-interfaces">
                        {interfaces.map((name) => (
                            <option key={name} value={name} />
                        ))}
                    </datalist>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="cfg-batch_ms">Batch interval (ms)</Label>
                    <Input {...field("batch_ms")} inputMode="numeric" />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="cfg-client_id">Sero client id</Label>
                    <Input {...field("client_id")} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="cfg-port">Sero port</Label>
                    <Input {...field("port")} inputMode="numeric" />
                </div>
                <div className="col-span-2 flex justify-end gap-2 pt-1">
                    <Button
                        variant="outline"
                        disabled={!changed || saving}
                        onClick={() => setForm(saved)}
                    >
                        Reset
                    </Button>
                    <Button disabled={!changed || saving} onClick={save}>
                        Save
                    </Button>
                </div>
                {patch === null && (
                    <p className="col-span-2 text-xs text-amber-400">
                        Batch interval, client id and port must be whole numbers.
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

export default TelemetryPage;
