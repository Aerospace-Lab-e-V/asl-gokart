import React from "react";
import { TurnSignalLeft, TurnSignalRight } from "@/components/icons/telltale";
import { Gears } from "@/data/controlling_models/drivetrain";
import { LightToggle } from "@/components/drive/light-toggle";
import { gearFor } from "@/components/drive/lamps";
import { useSignal } from "@/stores/signals";

const GEAR_ORDER: [Gears, string][] = [[Gears.p, "P"], [Gears.r, "R"], [Gears.n, "N"], [Gears.d, "D"]];

const GearIndicator = () => {
    const gear = gearFor(useSignal("drive.relay_1"), useSignal("drive.reverse"));
    return (
        <div className="flex gap-x-5 text-4xl">
            {GEAR_ORDER.map(([g, label]) => (
                <span key={g} className={g === gear ? "font-semibold text-foreground" : "text-muted-foreground/60"}>{label}</span>
            ))}
        </div>
    );
};

/** The gear strip between the turn signal buttons. */
export const GearRow = () => (
    <div className="flex items-center gap-x-6">
        <LightToggle signal="lights.turn_left" light="turn_left" label="left turn signal" icon={TurnSignalLeft} onClassName="text-green-600 dark:text-green-500" />
        <GearIndicator />
        <LightToggle signal="lights.turn_right" light="turn_right" label="right turn signal" icon={TurnSignalRight} onClassName="text-green-600 dark:text-green-500" />
    </div>
);
