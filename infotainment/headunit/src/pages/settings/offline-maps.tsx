import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Map as MapIcon, RefreshCw, Trash2, X } from "lucide-react";
import { Subpage } from "@/components/shared/subpage";
import { Button } from "@/components/ui/button";
import { SettingsRow, SettingsSection, Status } from "@/components/settings/settings-list";
import { updateAvailable, type MapArea, type MapPacksState } from "@/data/map-packs";
import { mapPacks } from "@/services/map-packs";

const BUTTON = "h-14 px-6 text-lg";
/** How long Delete stays armed after the first tap. */
const ARMED_MS = 3000;

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

function describe(area: MapArea, state: MapPacksState): string {
    const download = state.download?.id === area.id ? state.download : null;
    if (download) return `Downloading ${Math.floor((download.bytes / download.total) * 100)} % of ${megabytes(download.total)}`;
    if (updateAvailable(area)) return `Update available · ${megabytes(area.bytes)}`;
    if (area.installed) return `Downloaded ${day(area.installed.installedAt)} · ${megabytes(area.bytes)}`;
    return megabytes(area.bytes);
}

/** Map areas for the Drive page's Map style: download from the map server, then they work without it. */
const OfflineMapsPage = () => {
    const [state, setState] = useState<MapPacksState | null>(null);
    const [armed, setArmed] = useState<string | null>(null);
    const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const off = mapPacks.onState(setState);
        mapPacks.list().then(setState, (e) => toast.error(`Could not load the maps: ${errorText(e)}`));
        return () => {
            off();
            if (disarm.current) clearTimeout(disarm.current);
        };
    }, []);

    const install = (area: MapArea) =>
        mapPacks.install(area.id).then(
            () => toast.success(`${area.title} is ready for the Drive page`),
            (e) => toast.error(`${area.title}: ${errorText(e)}`)
        );

    const remove = (area: MapArea) => {
        if (armed !== area.id) {
            setArmed(area.id);
            if (disarm.current) clearTimeout(disarm.current);
            disarm.current = setTimeout(() => setArmed(null), ARMED_MS);
            return;
        }
        setArmed(null);
        mapPacks.remove(area.id).catch((e) => toast.error(`${area.title}: ${errorText(e)}`));
    };

    const busy = state?.download != null;

    const actions = (area: MapArea) => {
        if (state?.download?.id === area.id) {
            return (
                <Button variant="outline" className={BUTTON} onClick={() => mapPacks.cancel()}>
                    <X className="mr-2 h-5 w-5" /> Cancel
                </Button>
            );
        }
        return (
            <>
                {area.available && (!area.installed || updateAvailable(area)) && (
                    <Button className={BUTTON} disabled={busy} onClick={() => install(area)}>
                        <Download className="mr-2 h-5 w-5" /> {area.installed ? "Update" : "Download"}
                    </Button>
                )}
                {area.installed && (
                    <Button variant={armed === area.id ? "destructive" : "outline"} className={BUTTON} onClick={() => remove(area)}>
                        <Trash2 className="mr-2 h-5 w-5" /> {armed === area.id ? "Tap again to delete" : "Delete"}
                    </Button>
                )}
            </>
        );
    };

    const serverLine = !state
        ? null
        : state.serverError
          ? `Map server not reachable: ${state.serverError}`
          : !state.server
            ? "No map server: set the telemetry uplink's broker first, the maps come from the same server."
            : null;

    return (
        <Subpage
            title="Offline maps"
            description="Areas for the Drive page's Map style. Once downloaded they work without the map server."
            backTo="/settings"
            actions={
                <Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Refresh" disabled={busy} onClick={() => mapPacks.list().then(setState)}>
                    <RefreshCw className="h-6 w-6" />
                </Button>
            }
        >
            {!state && <Status>Loading…</Status>}
            {serverLine && (
                <p className="text-muted-foreground pt-4 text-lg" role="status">
                    {serverLine}
                </p>
            )}
            {state && state.areas.length > 0 && (
                <SettingsSection title="Areas">
                    {state.areas.map((area) => (
                        <SettingsRow key={area.id} icon={MapIcon} title={area.title} description={describe(area, state)}>
                            {actions(area)}
                        </SettingsRow>
                    ))}
                </SettingsSection>
            )}
            {state && state.areas.length === 0 && !serverLine && <Status>The map server offers no areas yet.</Status>}
        </Subpage>
    );
};

export default OfflineMapsPage;
