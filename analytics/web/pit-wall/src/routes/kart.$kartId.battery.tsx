import { createFileRoute } from "@tanstack/react-router";
import { PresetView } from "../components/PresetView";
import { PRESETS } from "../views/presets";

export const Route = createFileRoute("/kart/$kartId/battery")({
    component: BatteryView,
});

function BatteryView() {
    return <PresetView preset={PRESETS.battery} />;
}
