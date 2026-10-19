import { createFileRoute } from "@tanstack/react-router";
import { PresetView } from "../components/PresetView";
import { PRESETS } from "../views/presets";

export const Route = createFileRoute("/kart/$kartId/drivetrain")({
    component: DrivetrainView,
});

function DrivetrainView() {
    return <PresetView preset={PRESETS.drivetrain} />;
}
