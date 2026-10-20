import { HeaderBar } from "@/components/shared/header-bar";
import React, { useState } from "react";
import { ColorPicker } from "@/components/color-picker";
import { CirclePicker, ColorResult } from "react-color";
import { toast } from "sonner";
import { PRESET_COLORS } from "@/data/lighting/color-definitions";
import { Button } from "@/components/ui/button";
import { hexToRgb } from "@/lib/utils";
import type { Command } from "@/domain/commands";
import { send, useCommand } from "@/services/commands";
import { useSent } from "@/stores/sent";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

const presetColors = PRESET_COLORS.map(color => color.hex);

const toHex = (rgb: [number, number, number]) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

const TESTS: [string, Command][] = [
    ["Trigger Welcome", { type: "lights.welcome" }],
    ["Toggle Left Turn", { type: "lights.toggle", light: "turn_left" }],
    ["Toggle Right Turn", { type: "lights.toggle", light: "turn_right" }],
    ["Toggle Hazards", { type: "lights.toggle", light: "hazard" }],
    ["Toggle High Beams", { type: "lights.toggle", light: "high_beam" }],
    ["Toggle Brake", { type: "lights.toggle", light: "brake" }],
    ["Toggle Reverse", { type: "lights.toggle", light: "reverse" }],
    ["Toggle DRL", { type: "lights.toggle", light: "drl" }],
];

const fire = async (label: string, command: Command) => {
    const result = await send(command);
    if (!result.ok) toast.error(`${label} failed: ${result.error}`);
};

/** Global LED brightness: zc_lights has one value for all strips and does not echo it. */
const BrightnessCard = () => {
    const sent = useSent((s) => s["lights.setBrightness"]?.value);
    const sentPct = sent === undefined ? null : Math.round((sent * 100) / 255);
    const [pct, setPct] = useState(sentPct ?? 100);
    const { run, pending } = useCommand();

    const commit = async (value: number) => {
        const result = await run({ type: "lights.setBrightness", value: Math.round((value * 255) / 100) });
        if (!result.ok) toast.error(`Failed to set brightness: ${result.error}`);
    };

    return (
        <Card className="w-1/2">
            <CardHeader>
                <CardTitle>Brightness</CardTitle>
                <CardDescription>All light strips. Last sent: {sentPct === null ? "unknown" : `${sentPct}%`}</CardDescription>
            </CardHeader>
            <CardContent>
                <Slider
                    value={[pct]}
                    min={0}
                    max={100}
                    step={1}
                    disabled={pending}
                    onValueChange={(value) => setPct(value[0])}
                    onValueCommit={(value) => commit(value[0])}
                />
            </CardContent>
        </Card>
    );
};

const WelcomeLightCard = () => {
    const sent = useSent((s) => s["lights.setWelcomeColor"]?.rgb);
    const sentHex = sent ? toHex(sent) : null;
    // Picker position only; what the ECU has is the last sent value.
    const [color, setColor] = useState(sentHex ?? "#ffffff");
    const { run } = useCommand();

    const commit = async (c: ColorResult) => {
        const result = await run({ type: "lights.setWelcomeColor", rgb: hexToRgb(c.hex) });
        if (!result.ok) toast.error(`Failed to set welcome light color: ${result.error}`);
    };

    return (
        <Card className="w-1/2">
            <CardHeader>
                <CardTitle>Welcome Light</CardTitle>
                <CardDescription>Front eyebrows glow color on startup. Last sent: {sentHex ?? "unknown"}</CardDescription>
            </CardHeader>
            <CardContent>
                {/* TODO(firmware): zc_lights has no method to enable/disable the welcome light. */}
                <div className="flex flex-col gap-4">
                    <ColorPicker
                        color={color}
                        onChange={(c: any) => setColor(c.hex)}
                        onChangeComplete={commit}
                    />
                    <CirclePicker
                        color={color}
                        onChange={(c) => setColor(c.hex)}
                        onChangeComplete={commit}
                        circleSize={28}
                        circleSpacing={14}
                        colors={presetColors}
                    />
                </div>
            </CardContent>
        </Card>
    );
};

const CarPage = () => {
    return (
        <div className="flex flex-col h-screen overflow-hidden bg-background">
            <HeaderBar />
            <div className="flex-1 flex flex-col items-center justify-start p-8 overflow-hidden">
                <div className="flex flex-col items-center justify-center gap-2 w-full max-w-5xl">
                    <div className="flex flex-col md:flex-row w-full gap-8">

                    {/* TODO(firmware): underglow not implemented in zc_lights; re-enable <UnderglowCard /> (components/drive/underglow-card.tsx) when it is */}
                    <BrightnessCard />
                    <WelcomeLightCard />
                    </div>

                    {/* Lights Tester Panel */}
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle>Lights Tester</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-4">
                                {TESTS.map(([label, command]) => (
                                    <Button key={label} onClick={() => fire(label, command)}>{label}</Button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                </div>
            </div>
        </div>
    );
}

export default CarPage;
