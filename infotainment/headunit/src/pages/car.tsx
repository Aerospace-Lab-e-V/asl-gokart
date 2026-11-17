import React from "react";
import { CarFront, Lightbulb, Presentation, RectangleHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { HeaderBar } from "@/components/shared/header-bar";
import { KartVisual } from "@/components/lights/kart-visual";
import { readLightState, useSyncedWelcome } from "@/components/lights/light-state";
import { PlayWelcomeButton } from "@/components/lights/play-welcome-button";
import { SettingsLinkRow, SettingsRow, SettingsSection, SettingsSliderRow, SettingsSwitchRow } from "@/components/settings/settings-list";
import { findAnimation } from "@/domain/lights";
import type { Command } from "@/domain/commands";
import { useCommand } from "@/services/commands";
import { useSession } from "@/stores/session";
import { useSignal } from "@/stores/signals";

/*
 * The kart's lights: a live picture of what they show right now (and of the welcome while it plays) on
 * the left, the welcome settings on the right. Every value is zc_lights' own echo; nothing changes here
 * until the ECU confirms it.
 */

const toPercent = (v: number) => Math.round((v * 100) / 255);
const fromPercent = (p: number) => Math.round((p * 255) / 100);

function useSetting() {
    const { run, pending } = useCommand();
    const set = async (command: Command, what: string) => {
        const result = await run(command);
        if (!result.ok) toast.error(`Could not change ${what}: ${result.error}`);
    };
    return { set, pending };
}

const WelcomeSettings = () => {
    const enabled = useSignal("lights.welcome_enabled");
    const front = findAnimation("front", useSignal("lights.welcome_front"));
    const rear = findAnimation("rear", useSignal("lights.welcome_rear"));
    const ambient = useSignal("lights.ambient");
    const catalog = useSignal("lights.front_anims");
    const { set, pending } = useSetting();

    if (catalog === 0) {
        return (
            <SettingsSection title="Welcome">
                <SettingsRow
                    icon={Sparkles}
                    title="Welcome light"
                    description="The zc_lights firmware is too old. Update it in Settings → ECU Manager."
                />
            </SettingsSection>
        );
    }

    return (
        <SettingsSection title="Welcome">
            <SettingsSwitchRow
                id="welcome-enabled"
                icon={Sparkles}
                title="Welcome light"
                description="Plays when the kart is switched on"
                checked={enabled === 1}
                disabled={enabled === null || pending}
                onCheckedChange={(on) => set({ type: "lights.setWelcome", enabled: on }, "the welcome light")}
            />
            <SettingsLinkRow to="/car/welcome/front" icon={CarFront} title="Front" value={front?.name ?? "--"} />
            <SettingsLinkRow to="/car/welcome/rear" icon={RectangleHorizontal} title="Rear" value={rear?.name ?? "--"} />
            {ambient === null ? (
                <SettingsRow icon={Lightbulb} title="Brightness">
                    <span className="text-muted-foreground text-lg">--</span>
                </SettingsRow>
            ) : (
                <SettingsSliderRow
                    icon={Lightbulb}
                    title="Brightness"
                    unit="%"
                    value={toPercent(ambient)}
                    min={5}
                    max={100}
                    step={5}
                    onCommit={(p) => set({ type: "lights.setWelcome", ambient: fromPercent(p) }, "the brightness")}
                />
            )}
        </SettingsSection>
    );
};

const CarPage = () => {
    const plan = useSyncedWelcome();
    const adminMode = useSession((s) => s.adminMode);

    return (
        <div className="flex h-full w-full flex-col">
            <HeaderBar />
            <div className="grid min-h-0 flex-1 grid-cols-[9fr_11fr] gap-8 px-8 pb-6">
                <div className="flex min-h-0 flex-col gap-4 pt-4">
                    <KartVisual state={readLightState} plan={plan} className="min-h-0 flex-1" />
                    <PlayWelcomeButton />
                </div>
                <div className="min-h-0 overflow-y-auto">
                    <WelcomeSettings />
                    {adminMode && (
                        <SettingsSection title="Showroom">
                            <SettingsLinkRow
                                to="/car/showroom"
                                icon={Presentation}
                                title="Showroom"
                                description="Light test and welcome loop for exhibitions"
                            />
                        </SettingsSection>
                    )}
                    <p className="text-muted-foreground py-6 text-base">
                        Brake, reverse, the indicators or driving off stop the welcome at once.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CarPage;
