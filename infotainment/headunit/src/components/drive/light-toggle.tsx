import React from "react";
import type { TelltaleIcon } from "@/components/icons/telltale";
import { toast } from "sonner";
import type { SignalName } from "@/domain/signals";
import type { ToggleLight } from "@/domain/commands";
import { useSignal } from "@/stores/signals";
import { useCommand } from "@/services/commands";

interface LightToggleProps {
    /** On when this signal is 1. */
    signal: SignalName;
    /** Also on when this signal is 1 (e.g. the right high beam). */
    orSignal?: SignalName;
    light: ToggleLight;
    label: string;
    icon: TelltaleIcon;
    /** Text color class while on. */
    onClassName: string;
    /** Lights red instead, e.g. while the ECU behind it is not connected. */
    fault?: boolean;
}

/** Light icon showing the ECU's state; a tap asks the ECU to toggle it. */
export function LightToggle({ signal, orSignal, light, label, icon: Icon, onClassName, fault = false }: LightToggleProps) {
    const a = useSignal(signal);
    const b = useSignal(orSignal ?? signal);
    const on = a === 1 || b === 1;
    const lit = fault ? "text-red-600 dark:text-red-500" : on ? onClassName : null;
    const { run, pending } = useCommand();

    const toggle = async () => {
        const result = await run({ type: "lights.toggle", light });
        if (!result.ok) toast.error(`Failed to toggle ${label}: ${result.error}`);
    };

    return (
        <button type="button" aria-label={label} aria-pressed={on} disabled={pending} onClick={toggle} className="p-2 disabled:opacity-50">
            <Icon size={48} className={lit ? `${lit} dark:drop-shadow-[0_0_6px_currentColor]` : "text-muted-foreground/60"} />
        </button>
    );
}
