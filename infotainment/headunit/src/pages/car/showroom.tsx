import React, { useEffect, useState } from "react";
import { readLightState } from "@/components/lights/light-state";
import { toast } from "sonner";
import { Subpage } from "@/components/shared/subpage";
import { SettingsRow, SettingsSection, SettingsSliderRow, SettingsSwitchRow } from "@/components/settings/settings-list";
import { PlayWelcomeButton } from "@/components/lights/play-welcome-button";
import type { Command, SettableLight, ToggleLight } from "@/domain/commands";
import type { SignalName } from "@/domain/signals";
import { useCommand } from "@/services/commands";
import { setLooping, setPause, useShowroom } from "@/stores/showroom";
import { useSignal } from "@/stores/signals";
import type { Turn } from "@/lib/lights/compositor";

/*
 * Admin-only page for exhibition booths: switch every light by hand and replay the welcome in a loop.
 * Switches show zc_lights' reported state.
 */

const LIGHTS: { light: SettableLight; signal: SignalName; title: string }[] = [
    { light: "drl", signal: "lights.drl", title: "Daytime running lights" },
    { light: "tail", signal: "lights.tail", title: "Tail light" },
    { light: "high_beam", signal: "lights.high_beam_left", title: "High beams" },
    { light: "brake", signal: "lights.brake", title: "Brake light" },
    { light: "reverse", signal: "lights.reverse", title: "Reverse light" },
];

const INDICATORS: { light: ToggleLight; signal: SignalName; title: string; turn: Turn }[] = [
    { light: "turn_left", signal: "lights.turn_left", title: "Left indicator", turn: "left" },
    { light: "turn_right", signal: "lights.turn_right", title: "Right indicator", turn: "right" },
    { light: "hazard", signal: "lights.hazard", title: "Hazard lights", turn: "hazard" },
];

/** zc_lights reports the blink itself (on, off, on…); readLightState holds it through the dark phase. */
function useTurn(): Turn {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, []);
    return readLightState(now).turn;
}

function useSend() {
    const { run, pending } = useCommand();
    const send = async (command: Command, what: string) => {
        const result = await run(command);
        if (!result.ok) toast.error(`${what} failed: ${result.error}`);
    };
    return { send, pending };
}

function LightRow({ light, signal, title }: (typeof LIGHTS)[number]) {
    const on = useSignal(signal);
    const { send, pending } = useSend();
    return (
        <SettingsSwitchRow
            id={`showroom-${light}`}
            title={title}
            checked={on === 1}
            disabled={on === null || pending}
            onCheckedChange={(v) => send({ type: "lights.set", light, on: v }, title)}
        />
    );
}

function IndicatorRow({ light, signal, title, turn }: (typeof INDICATORS)[number]) {
    const on = useTurn() === turn;
    const known = useSignal(signal) !== null;
    const { send, pending } = useSend();
    return (
        <SettingsSwitchRow
            id={`showroom-${light}`}
            title={title}
            checked={on}
            disabled={!known || pending}
            onCheckedChange={() => send({ type: "lights.toggle", light }, title)}
        />
    );
}

const ShowroomPage = () => {
    const { looping, pauseS, error } = useShowroom();

    return (
        <Subpage title="Showroom" description="Light test and welcome loop for exhibitions" backTo="/car">
            <SettingsSection title="Welcome">
                <SettingsSwitchRow
                    id="showroom-loop"
                    title="Loop welcome"
                    description={
                        error ? <span className="text-amber-500">Stopped: {error}</span> : "Plays the welcome again and again until switched off"
                    }
                    checked={looping}
                    onCheckedChange={setLooping}
                />
                <SettingsSliderRow title="Pause between plays" unit="s" value={pauseS} min={5} max={120} step={5} onCommit={setPause} />
                <SettingsRow title="Play once">
                    <PlayWelcomeButton showReason={false} />
                </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Lights">
                {LIGHTS.map((l) => (
                    <LightRow key={l.light} {...l} />
                ))}
            </SettingsSection>

            <SettingsSection title="Indicators">
                {INDICATORS.map((l) => (
                    <IndicatorRow key={l.light} {...l} />
                ))}
            </SettingsSection>
        </Subpage>
    );
};

export default ShowroomPage;
