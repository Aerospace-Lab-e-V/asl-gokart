import { createFileRoute } from "@tanstack/react-router";
import { PresetView } from "../components/PresetView";
import { PRESETS } from "../views/presets";

export const Route = createFileRoute("/kart/$kartId/thermal")({
    component: ThermalView,
});

function ThermalView() {
    return <PresetView preset={PRESETS.thermal} />;
}
