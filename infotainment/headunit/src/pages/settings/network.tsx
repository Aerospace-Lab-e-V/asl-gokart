import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { EthernetPort, Loader2, Wifi } from "lucide-react";
import { Subpage } from "@/components/shared/subpage";
import { Button } from "@/components/ui/button";
import { RowBadge, SettingsRadioRow, SettingsSection } from "@/components/settings/settings-list";
import { NetworkInterface, NetworkInterfaceFamily, NetworkInterfaceType, parseNetworkInterfaces } from "@/lib/types";
import { hardware } from "@/services/hardware";
import log from "@/lib/logger";

/**
 * The services bind to the IPv4 address of the chosen interface, so only interfaces
 * that have one can be chosen; one entry per MAC.
 */
const selectable = (interfaces: NetworkInterface[]) => [
    ...new Map(
        interfaces
            .filter((i) => i.family === NetworkInterfaceFamily.IPv4 && !i.internal)
            .map((i) => [i.mac, i] as const)
    ).values(),
];

const NetworkInterfacePage = () => {
    const [interfaces, setInterfaces] = useState<NetworkInterface[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [currentMac, setCurrentMac] = useState<string | null>(null);
    const [selectedMac, setSelectedMac] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [raw, current] = await Promise.all([
                    hardware.getAvailableNetworkInterfaces(),
                    hardware.getNetworkInterface(),
                ]);
                setInterfaces(selectable(parseNetworkInterfaces(raw)));
                setCurrentMac(current?.mac ?? null);
                setSelectedMac(current?.mac ?? null);
            } catch (e) {
                log.error("Failed to load network interfaces:", e);
                setLoadError(e instanceof Error ? e.message : String(e));
            }
        };
        load();
    }, []);

    const changed = selectedMac !== null && selectedMac !== currentMac;

    const save = async () => {
        if (!changed) return;
        setSaving(true);
        try {
            const result = await hardware.setNetworkInterface(selectedMac);
            log.info("Background network interface changed:", result);
            setCurrentMac(result?.mac ?? null);
            setSelectedMac(result?.mac ?? null);
            toast(result ? `Services now use ${result.name}` : "Services now listen on all interfaces");
        } catch (e) {
            log.error("Failed to set network interface:", e);
            toast.error(`Not saved: ${e instanceof Error ? e.message : e}`);
        } finally {
            setSaving(false);
        }
    };

    const group = (title: string, type: NetworkInterfaceType) => {
        const members = interfaces?.filter((i) => i.type === type) ?? [];
        if (members.length === 0) return null;
        return (
            <SettingsSection title={title} role="radiogroup">
                {members.map((iface) => (
                    <SettingsRadioRow
                        key={iface.mac}
                        icon={type === NetworkInterfaceType.Wireless ? Wifi : EthernetPort}
                        title={iface.name}
                        description={
                            <>
                                {iface.address} <span className="font-mono text-sm">· {iface.mac}</span>
                            </>
                        }
                        checked={iface.mac === selectedMac}
                        disabled={saving}
                        onSelect={() => setSelectedMac(iface.mac)}
                    >
                        {iface.mac === currentMac && <RowBadge>In use</RowBadge>}
                    </SettingsRadioRow>
                ))}
            </SettingsSection>
        );
    };

    return (
        <Subpage
            title="Network interface"
            description="The network the SERO and firmware services listen on"
            backTo="/settings"
            backDisabled={saving}
            footer={
                <Button className="h-14 px-8 text-lg" disabled={!changed || saving} onClick={save}>
                    {saving && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    {saving ? "Restarting services…" : "Save and restart services"}
                </Button>
            }
        >
            {loadError ? (
                <p className="flex flex-1 text-red-500 items-center justify-center text-xl">
                    Could not read the network interfaces: {loadError}
                </p>
            ) : !interfaces ? (
                <div className="text-muted-foreground flex flex-1 items-center justify-center gap-3 text-xl" role="status">
                    <Loader2 className="h-7 w-7 animate-spin" />
                    Looking for interfaces…
                </div>
            ) : interfaces.length === 0 ? (
                <p className="text-muted-foreground flex flex-1 items-center justify-center text-xl">
                    No network interface with an IPv4 address
                </p>
            ) : (
                <>
                    {!currentMac && (
                        <p className="text-muted-foreground pt-4 text-lg">
                            No interface chosen: the services listen on all interfaces (0.0.0.0).
                        </p>
                    )}
                    {group("Wired", NetworkInterfaceType.Wired)}
                    {group("Wireless", NetworkInterfaceType.Wireless)}
                </>
            )}
        </Subpage>
    );
};

export default NetworkInterfacePage;
