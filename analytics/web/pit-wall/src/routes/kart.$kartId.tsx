import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { historyQueryOptions } from "../api/history";
import { lapsQueryOptions } from "../api/laps";
import { PresetDock, PresetTabs } from "../components/PresetNav";
import { StatusBar } from "../components/StatusBar";
import { WindowSelect } from "../components/WindowSelect";
import { live } from "../live/connection";
import { useKartStatus } from "../live/hooks";
import { laps } from "../live/laps";
import { telemetry } from "../live/store";
import { WINDOWS_MIN, type WindowMin } from "../views/presets";
import { useWindowMin } from "../views/useWindowMin";

export const Route = createFileRoute("/kart/$kartId")({
    // Optional, so links without `?window` stay valid; absent means the default.
    validateSearch: (search: Record<string, unknown>): { window?: WindowMin } => {
        const w = Number(search.window);
        return WINDOWS_MIN.includes(w as WindowMin) ? { window: w as WindowMin } : {};
    },
    component: KartLayout,
});

function KartLayout() {
    const { kartId } = Route.useParams();
    const window = useWindowMin();
    const { config } = Route.useRouteContext();
    const sessionId = useKartStatus(kartId)?.sessionId;

    useEffect(() => {
        live.watch(kartId);
        return () => live.watch(null);
    }, [kartId]);

    // Fill the charts with the session's recent past; live data appends from there.
    const history = useQuery({
        ...historyQueryOptions({
            apiBaseUrl: config.apiBaseUrl,
            kartId,
            sessionId: sessionId ?? "",
            windowMin: window,
        }),
        enabled: Boolean(sessionId),
    });
    useEffect(() => {
        if (history.data && sessionId) telemetry.seed(sessionId, history.data);
    }, [history.data, sessionId]);

    // Laps of the whole session so far; new crossings arrive over MQTT.
    const lapHistory = useQuery({
        ...lapsQueryOptions({ apiBaseUrl: config.apiBaseUrl, kartId, sessionId: sessionId ?? "" }),
        enabled: Boolean(sessionId),
    });
    useEffect(() => {
        if (!sessionId) return;
        if (lapHistory.data) laps.seed(sessionId, lapHistory.data);
        else if (laps.sessionId !== sessionId) laps.reset(sessionId);
    }, [lapHistory.data, sessionId]);

    return (
        <div className="flex flex-col gap-3 sm:gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-semibold">{kartId}</h1>
                <WindowSelect value={window} />
            </div>
            <StatusBar kartId={kartId} historyError={history.isError} />
            <PresetTabs kartId={kartId} />
            <Outlet />
            <PresetDock kartId={kartId} />
        </div>
    );
}
