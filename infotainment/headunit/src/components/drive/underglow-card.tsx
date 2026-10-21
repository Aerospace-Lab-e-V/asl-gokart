import React, { useState } from "react";
import { CirclePicker } from "react-color";
import { ColorPicker } from "@/components/color-picker";
import { PRESET_COLORS } from "@/data/lighting/color-definitions";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const presetColors = PRESET_COLORS.map((color) => color.hex);

/*
 * TODO(firmware): underglow not implemented in zc_lights; not mounted anywhere. When it is, add
 * commands to domain/commands.ts, send them here on user intent and show the ECU echo instead of local state.
 */
export function UnderglowCard() {
    const [on, setOn] = useState(false);
    const [brightness, setBrightness] = useState(100);
    const [color, setColor] = useState("#ffffff");

    return (
        <Card className="w-1/2">
            <CardHeader>
                <CardTitle>
                    <div className="flex items-center justify-between">
                        Underglow
                        <Switch className="ml-4" checked={on} onCheckedChange={setOn} />
                    </div>
                </CardTitle>
                <CardDescription>Illuminate the tarmac!</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-4">
                    <Slider value={[brightness]} min={0} max={100} step={1} onValueChange={(value) => setBrightness(value[0])} />
                    <ColorPicker color={color} onChange={(c: any) => setColor(c.hex)} />
                    <CirclePicker
                        color={color}
                        onChange={(c) => setColor(c.hex)}
                        circleSize={28}
                        circleSpacing={14}
                        colors={presetColors}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
