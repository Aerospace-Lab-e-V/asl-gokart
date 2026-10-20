import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { agent } from "@/services/agent";
import { hardware } from "@/services/hardware";
import { AgentConfig, ConfigPatch } from "@/services/kart-agent/schema";
import { NetworkInterfaceFamily, parseNetworkInterfaces } from "@/lib/types/hardware";
import log from "@/lib/logger";

/** The settings that change at the track; everything else lives in kart-agent's TOML. */
export type Form = { kart_id: string; broker_url: string; interface: string };

const toForm = (c: AgentConfig): Form => ({
    kart_id: c.kart_id,
    broker_url: c.live.broker_url,
    interface: c.sero.interface,
});

/** The changed fields as a merge patch. */
export function formPatch(saved: Form, edited: Form): ConfigPatch {
    const patch: ConfigPatch = {};
    if (edited.kart_id.trim() !== saved.kart_id) patch.kart_id = edited.kart_id.trim();
    if (edited.broker_url.trim() !== saved.broker_url) patch.live = { broker_url: edited.broker_url.trim() };
    if (edited.interface !== saved.interface) patch.sero = { interface: edited.interface };
    return patch;
}

export const TelemetryConfigDialog = ({ trigger }: { trigger: React.ReactNode }) => {
    const [open, setOpen] = useState(false);
    const [saved, setSaved] = useState<Form | null>(null);
    const [form, setForm] = useState<Form | null>(null);
    const [interfaces, setInterfaces] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) {
            setForm(null);
            return;
        }
        agent
            .getConfig()
            .then((reply) => {
                setSaved(toForm(reply.effective));
                setForm(toForm(reply.effective));
            })
            .catch((e) => {
                log.error(e);
                toast.error(`Could not load the settings: ${e instanceof Error ? e.message : e}`);
                setOpen(false);
            });
        hardware
            .getAvailableNetworkInterfaces()
            .then((raw) => {
                const names = parseNetworkInterfaces(raw)
                    .filter((i) => i.family === NetworkInterfaceFamily.IPv4 && !i.internal)
                    .map((i) => i.name);
                setInterfaces([...new Set(names)]);
            })
            .catch((e) => log.error(e));
    }, [open]);

    const patch = saved && form ? formPatch(saved, form) : {};
    const changed = Object.keys(patch).length > 0;
    // The configured interface may be down right now; keep it selectable.
    const options = form && !interfaces.includes(form.interface) ? [form.interface, ...interfaces] : interfaces;

    const save = async () => {
        setSaving(true);
        try {
            const reply = await agent.putConfig(patch);
            toast(reply.restart_required ? "Saved, telemetry is restarting…" : "Saved");
            setOpen(false);
        } catch (e) {
            toast.error(`Not saved: ${e instanceof Error ? e.message : e}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="max-w-xl gap-6">
                <DialogHeader>
                    <DialogTitle className="text-xl">Telemetry settings</DialogTitle>
                </DialogHeader>

                {form ? (
                    <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="cfg-kart-id" className="text-base">Kart id</Label>
                            <Input
                                id="cfg-kart-id"
                                className="h-12 text-lg"
                                value={form.kart_id}
                                onChange={(e) => setForm({ ...form, kart_id: e.target.value })}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="cfg-broker" className="text-base">Pit wall broker</Label>
                            <Input
                                id="cfg-broker"
                                className="h-12 text-lg"
                                placeholder="mqtt://host:1883"
                                value={form.broker_url}
                                onChange={(e) => setForm({ ...form, broker_url: e.target.value })}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="cfg-interface" className="text-base">Car network</Label>
                            <Select value={form.interface} onValueChange={(v) => setForm({ ...form, interface: v })}>
                                <SelectTrigger id="cfg-interface" className="h-12 text-lg">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.map((name) => (
                                        <SelectItem key={name} value={name} className="h-12 text-lg">
                                            {name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                ) : (
                    <Loader2 className="text-muted-foreground mx-auto h-8 w-8 animate-spin" />
                )}

                <div className="flex justify-end gap-3">
                    <Button variant="outline" className="h-12 px-6 text-base" disabled={saving} onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button className="h-12 px-6 text-base" disabled={!changed || saving} onClick={save}>
                        {saving && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                        Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
