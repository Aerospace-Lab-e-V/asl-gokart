import React, { useEffect, useState } from "react";
import type { Color, ColorResult } from "react-color";
import { ColorPicker } from "@/components/color-picker";
import { rgbToHex, type Rgb } from "@/domain/lights";
import { cn } from "@/lib/utils";

/** Colours that look good on the LEDs (fully saturated, no amber: that is the turn signal). */
export const LED_PRESETS: { name: string; rgb: Rgb }[] = [
    { name: "Blue", rgb: [0, 100, 255] },
    { name: "Ice", rgb: [0, 200, 255] },
    { name: "White", rgb: [255, 255, 255] },
    { name: "Red", rgb: [255, 0, 0] },
    { name: "Magenta", rgb: [255, 0, 120] },
    { name: "Purple", rgb: [140, 0, 255] },
    { name: "Green", rgb: [0, 255, 60] },
    { name: "Mint", rgb: [0, 255, 160] },
];

/** Fully saturated colour of a hue (0-360). */
function hueToRgb(h: number): Rgb {
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
}

/** The hue picker reports a ColorResult; its typings also allow a bare Color. */
const hueOf = (c: ColorResult | Color): number | null => (typeof c === "object" && "hsl" in c && c.hsl ? c.hsl.h : null);

const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

interface ColorSwatchesProps {
    /** The ECU's colour. */
    value: Rgb;
    disabled?: boolean;
    /** Called once per choice (tap, or the finger lifting off the hue bar). Resolves false when the ECU refused it. */
    onCommit: (rgb: Rgb) => Promise<boolean> | void;
}

/** How long a chosen colour is shown while waiting for the ECU to report it. */
const ECHO_TIMEOUT_MS = 3000;

/** Large preset swatches plus a hue bar for any other colour. */
export function ColorSwatches({ value, disabled, onCommit }: ColorSwatchesProps) {
    // The hue bar follows the finger; once dropped, the chosen colour stays until the ECU reports a
    // colour (or refuses, or stays silent), so the bar does not jump back to the old value meanwhile.
    const [dragging, setDragging] = useState<Rgb | null>(null);
    const [chosen, setChosen] = useState<Rgb | null>(null);
    const shown = dragging ?? chosen ?? value;
    const valueKey = rgbToHex(value);

    useEffect(() => setChosen(null), [valueKey]);
    useEffect(() => {
        if (!chosen) return;
        const t = setTimeout(() => setChosen(null), ECHO_TIMEOUT_MS);
        return () => clearTimeout(t);
    }, [chosen]);

    const commit = async (rgb: Rgb) => {
        setDragging(null);
        setChosen(rgb);
        if ((await onCommit(rgb)) === false) setChosen(null);
    };

    return (
        <div className={cn("flex flex-col gap-5", disabled && "pointer-events-none opacity-50")}>
            <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Colour">
                {LED_PRESETS.map((p) => {
                    const checked = same(p.rgb, shown);
                    return (
                        <button
                            key={p.name}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            aria-label={p.name}
                            onClick={() => commit(p.rgb)}
                            className={cn(
                                "h-14 w-14 rounded-full transition-transform active:scale-95",
                                checked ? "ring-foreground ring-offset-background ring-2 ring-offset-4" : "ring-border ring-1",
                            )}
                            style={{ backgroundColor: rgbToHex(p.rgb) }}
                        />
                    );
                })}
            </div>
            <ColorPicker
                className="h-10"
                color={rgbToHex(shown)}
                onChange={(c: ColorResult | Color) => {
                    const h = hueOf(c);
                    if (h !== null) setDragging(hueToRgb(h));
                }}
                {...{
                    onChangeComplete: (c: ColorResult | Color) => {
                        const h = hueOf(c);
                        if (h !== null) commit(hueToRgb(h));
                    },
                }}
            />
        </div>
    );
}
