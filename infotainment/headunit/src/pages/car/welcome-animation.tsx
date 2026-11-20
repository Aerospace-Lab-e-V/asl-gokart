import React from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Subpage } from "@/components/shared/subpage";
import { SettingsSection } from "@/components/settings/settings-list";
import { AnimationTile } from "@/components/lights/animation-tile";
import { ColorSwatches } from "@/components/lights/color-swatches";
import { PlayWelcomeButton } from "@/components/lights/play-welcome-button";
import {
    ANIMATIONS,
    catalogSignal,
    colorSignal,
    findAnimation,
    numberToRgb,
    selectedSignal,
    type AnimationInfo,
    type AnimationLayer,
    type Rgb,
} from "@/domain/lights";
import { useCommand } from "@/services/commands";
import { useSignal } from "@/stores/signals";

const TITLES: Record<AnimationLayer, { title: string; description: string }> = {
    front: { title: "Front welcome", description: "Daytime running lights. Plays first." },
    rear: { title: "Rear welcome", description: "Rear light bar. Starts once the front has built up." },
};

/** The ECU's colour for an animation (its default for fixed-colour ones or until the ECU reported it). */
function useAnimationColor(a: AnimationInfo): Rgb {
    // Fixed-colour animations have no colour signal; it reads as null.
    const n = useSignal(colorSignal(a));
    return a.customColor && n !== null ? numberToRgb(n) : [...a.defaultColor];
}

function Tile({ animation, selected, disabled, onSelect }: { animation: AnimationInfo; selected: boolean; disabled: boolean; onSelect: () => void }) {
    const color = useAnimationColor(animation);
    return <AnimationTile animation={animation} color={color} selected={selected} disabled={disabled} onSelect={onSelect} />;
}

function ColorSection({ animation }: { animation: AnimationInfo }) {
    const color = useAnimationColor(animation);
    const known = useSignal(colorSignal(animation)) !== null;
    const { run, pending } = useCommand();

    const commit = async (rgb: Rgb) => {
        const result = await run({ type: "lights.setAnimationColor", layer: animation.layer, id: animation.id, rgb });
        if (!result.ok) toast.error(`Could not change the colour: ${result.error}`);
        return result.ok;
    };

    return (
        <SettingsSection title={`${animation.name} colour`}>
            <div className="px-4 py-5">
                <ColorSwatches value={color} disabled={!known || pending} onCommit={commit} />
            </div>
        </SettingsSection>
    );
}

const WelcomeAnimationPage = () => {
    const layer: AnimationLayer = useParams().layer === "rear" ? "rear" : "front";
    const selectedId = useSignal(selectedSignal(layer));
    const mask = useSignal(catalogSignal(layer));
    const selected = findAnimation(layer, selectedId);
    const { run, pending } = useCommand();

    // Only what both the headunit and the firmware have; everything until the firmware reported.
    const offered = ANIMATIONS[layer].filter((a) => mask === null || (mask & (1 << a.id)) !== 0);

    const choose = async (a: AnimationInfo) => {
        if (a.id === selectedId) return;
        const result = await run(layer === "front" ? { type: "lights.setWelcome", front: a.id } : { type: "lights.setWelcome", rear: a.id });
        if (!result.ok) toast.error(`Could not choose ${a.name}: ${result.error}`);
    };

    return (
        <Subpage
            title={TITLES[layer].title}
            description={TITLES[layer].description}
            backTo="/car"
            actions={<PlayWelcomeButton showReason={false} />}
        >
            <SettingsSection title="Animation" role="radiogroup">
                <div className="grid grid-cols-2 gap-4 px-4 py-5">
                    {offered.map((a) => (
                        <Tile key={a.id} animation={a} selected={a.id === selectedId} disabled={selectedId === null || pending} onSelect={() => choose(a)} />
                    ))}
                </div>
            </SettingsSection>
            {selected &&
                (selected.customColor ? (
                    <ColorSection animation={selected} />
                ) : (
                    <p className="text-muted-foreground px-0 py-6 text-lg">{selected.name} always plays in its own colour.</p>
                ))}
        </Subpage>
    );
};

export default WelcomeAnimationPage;
