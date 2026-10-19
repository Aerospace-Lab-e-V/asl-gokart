import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useLive } from "../live/hooks";

export const Route = createFileRoute("/")({
    component: KartPicker,
});

// Jump straight to the kart when exactly one is online, but only on the first visit:
// coming back here must show the list.
let autoPicked = false;
function claimAutoPick(): boolean {
    if (autoPicked) return false;
    autoPicked = true;
    return true;
}

function KartPicker() {
    const { broker, karts } = useLive();
    const navigate = useNavigate();
    const entries = [...karts].sort(([a], [b]) => a.localeCompare(b));
    const online = entries.filter(([, s]) => s.online);
    const onlyOnline = online.length === 1 ? online[0]![0] : null;

    useEffect(() => {
        if (!onlyOnline || !claimAutoPick()) return;
        void navigate({ to: "/kart/$kartId", params: { kartId: onlyOnline } });
    }, [onlyOnline, navigate]);

    return (
        <div className="mx-auto flex max-w-xl flex-col gap-4">
            <h1 className="text-xl font-semibold">Karts</h1>
            {entries.length === 0 ? (
                <p className="text-base-content/70 flex items-center gap-2">
                    {broker === "connected" ? (
                        "No kart has reported yet."
                    ) : (
                        <>
                            <span className="loading loading-spinner loading-sm" />
                            Connecting to the broker…
                        </>
                    )}
                </p>
            ) : (
                <ul className="list bg-base-200 rounded-box">
                    {entries.map(([kartId, status]) => (
                        <li key={kartId}>
                            <Link
                                to="/kart/$kartId"
                                params={{ kartId }}
                                className="list-row hover:bg-base-300 items-center"
                            >
                                <span
                                    className={`status status-lg ${status.online ? "status-success" : "status-neutral"}`}
                                    aria-hidden="true"
                                />
                                <div>
                                    <div className="font-medium">{kartId}</div>
                                    <div className="text-base-content/60 text-xs">
                                        {status.online ? "Online" : "Offline"} ·{" "}
                                        {status.agentVersion}
                                    </div>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
