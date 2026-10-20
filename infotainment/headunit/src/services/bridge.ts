import { useSignals } from "@/stores/signals";
import { useAgent } from "@/stores/agent";
import { useApp } from "@/stores/app";
import { useSession } from "@/stores/session";

/*
 * Pipes main's pushes into the stores. Started once from renderer.ts, outside React, so ingestion
 * does not depend on what is mounted. Each push is one store write.
 */
export function startBridge(): () => void {
    const { api } = window;
    const offs = [
        api.signals.onBatch((batch) => useSignals.setState(batch)),
        api.agent.onState((state) => useAgent.setState(state)),
        api.hardware.onConnection((lanConnected) => useApp.setState({ lanConnected })),
        api.admin.onState((adminMode) => useSession.setState({ adminMode })),
    ];
    // Snapshots after subscribing, so nothing pushed in between is lost; a push that arrived first wins.
    api.signals.snapshot().then((all) => useSignals.setState((cur) => ({ ...all, ...cur })));
    api.agent.getState().then((state) => useAgent.setState((cur) => (cur.status || cur.error ? cur : state)));
    api.hardware.getConnection().then((c) => useApp.setState((cur) => ({ lanConnected: cur.lanConnected ?? c })));
    api.admin.get().then((adminMode) => useSession.setState({ adminMode }));
    api.app.getVersion().then((version) => useApp.setState({ version }));
    return () => offs.forEach((off) => off());
}
