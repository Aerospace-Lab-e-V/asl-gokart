import { createFileRoute } from "@tanstack/react-router";
import { PresetView } from "../components/PresetView";
import { PRESETS } from "../views/presets";

export const Route = createFileRoute("/kart/$kartId/")({
    component: OverviewView,
});

function OverviewView() {
    return <PresetView preset={PRESETS.overview} />;
}
