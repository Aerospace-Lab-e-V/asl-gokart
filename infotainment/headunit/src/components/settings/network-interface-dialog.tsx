import React, { useEffect } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import log from "@/lib/logger";
import { NetworkInterface, NetworkInterfaceType, parseNetworkInterfaces } from "@/lib/types";
import { Loader2 } from "lucide-react";

type NetworkInterfaceDialogProps = {
    trigger: React.ReactNode;
};

export const NetworkInterfaceDialog = ({ trigger }: NetworkInterfaceDialogProps) => {

    const [open, setOpen] = React.useState(false);
    const [availableInterfaces, setAvailableInterfaces] = React.useState<NetworkInterface[]>([]);

    const [currentMac, setCurrentMac] = React.useState<string | null>(null);
    const [selectedMac, setSelectedMac] = React.useState<string | null>(null);

    const [saving, setSaving] = React.useState(false);

    const wiredInterfaces = availableInterfaces.filter(iface => iface.type === NetworkInterfaceType.Wired);
    const wirelessInterfaces = availableInterfaces.filter(iface => iface.type === NetworkInterfaceType.Wireless);

    const currentInterface = availableInterfaces.find(iface => iface.mac === currentMac) ?? null;

    const hasChanged = selectedMac !== null && selectedMac !== currentMac;

    useEffect(() => {
        if (!open) return;
        const load = async () => {
            const [raw, current] = await Promise.all([
                window.hardware.getAvailableNetworkInterfaces(),
                window.hardware.getNetworkInterface(),
            ]);
            const parsed = parseNetworkInterfaces(raw);
            setAvailableInterfaces(parsed);

            const mac = current?.mac ?? null;
            setCurrentMac(mac);
            setSelectedMac(mac);
        };
        load();
    }, [open]);

    const handleSave = async () => {
        if (!hasChanged || !selectedMac) return;
        setSaving(true);
        try {
            const result = await window.hardware.setNetworkInterface(selectedMac);
            log.info("Background network interface changed:", result);
            setCurrentMac(result?.mac ?? null);
            setSelectedMac(result?.mac ?? null);
        } catch (err) {
            log.error("Failed to set network interface:", err);
        } finally {
            setSaving(false);
        }
    };

    const interfaceSelectItems = (
        <>
            {wiredInterfaces.length > 0 && (
                <SelectGroup>
                    <SelectLabel>Wired</SelectLabel>
                    {wiredInterfaces.map((iface) => (
                        <SelectItem key={iface.mac} value={iface.mac}>{iface.name} ({iface.family})</SelectItem>
                    ))}
                </SelectGroup>
            )}
            {wirelessInterfaces.length > 0 && (
                <SelectGroup>
                    <SelectLabel>Wireless</SelectLabel>
                    {wirelessInterfaces.map((iface) => (
                        <SelectItem key={iface.mac} value={iface.mac}>{iface.name} ({iface.family})</SelectItem>
                    ))}
                </SelectGroup>
            )}
        </>
    );

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!saving) setOpen(v);
            }}>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
                <DialogContent className="max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Network Interface Configuration</DialogTitle>
                        <DialogDescription>
                            Configure the network interfaces used by all backend services.
                        </DialogDescription>
                    </DialogHeader>

                    <Separator className="my-2" />

                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium">Background Services (WS &amp; SERO)</p>
                        <Select
                            value={selectedMac ?? undefined}
                            onValueChange={setSelectedMac}
                            disabled={saving}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Network Interface" />
                            </SelectTrigger>
                            <SelectContent>
                                {interfaceSelectItems}
                            </SelectContent>
                        </Select>
                        {currentInterface ? (
                            <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                                <p className="font-medium text-foreground text-sm">Active Interface</p>
                                <p>{currentInterface.name} &mdash; {currentInterface.address}</p>
                                <p className="font-mono">{currentInterface.mac}</p>
                                <p>{currentInterface.type === NetworkInterfaceType.Wireless ? "Wireless" : "Wired"} &mdash; /{currentInterface.netmask}</p>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                No interface selected. Services bind to all interfaces (0.0.0.0).
                            </p>
                        )}
                    </div>

                    <Separator className="my-2" />

                    <Button
                        disabled={!hasChanged || saving}
                        onClick={handleSave}
                        className="self-end"
                    >
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {saving ? "Restarting..." : "Save"}
                    </Button>
                </DialogContent>
        </Dialog>
    );
}