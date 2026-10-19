import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/kart/$kartId/track")({
    component: TrackView,
});

// Placeholder: 2D track maps with the GPS position and heatmaps come later.
function TrackView() {
    return (
        <div className="card bg-base-200">
            <div className="card-body items-center text-center">
                <h2 className="card-title">Track map</h2>
                <p className="text-base-content/70">
                    Coming later: track maps with the kart's GPS position.
                </p>
            </div>
        </div>
    );
}
