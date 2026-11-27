import { Delete } from "lucide-react";
import React, { useState } from "react";
import { cn } from "@/lib/utils";

const PIN_LENGTH = 5;

/**
 * A key that fires on finger-down rather than on click. On the kart's touchscreen a click gets lost
 * whenever the finger drifts a few pixels (the touch turns into a scroll of the page) or lifts over
 * the gap between keys, and quick double taps can be taken as a gesture. Keyboard activation (Enter /
 * Space, which arrives as a click with `detail === 0`) still works.
 */
const PadKey = ({
    children,
    onPress,
    disabled,
    variant = "digit",
    label,
}: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    variant?: "digit" | "utility";
    label?: string;
}) => {
    // Own pressed state: Chromium delays :active for touches inside a scroll container.
    const [pressed, setPressed] = useState(false);
    const release = () => setPressed(false);
    // A disabled button gets no pointerup (the 5th digit disables every digit key mid-press),
    // so drop the pressed look whenever the key becomes disabled.
    const [wasDisabled, setWasDisabled] = useState(disabled);
    if (disabled !== wasDisabled) {
        setWasDisabled(disabled);
        if (disabled) setPressed(false);
    }

    return (
        <button
            type="button"
            aria-label={label}
            disabled={disabled}
            data-pressed={pressed || undefined}
            onPointerDown={(e) => {
                if (e.button !== 0) return;
                setPressed(true);
                onPress();
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerLeave={release}
            onClick={(e) => {
                if (e.detail === 0) onPress();
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(
                "group h-18 w-full touch-manipulation select-none rounded-xl border",
                "transition-colors duration-100 data-pressed:duration-0",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "disabled:pointer-events-none disabled:opacity-35",
                variant === "digit" && [
                    "border-border bg-card text-foreground shadow-sm",
                    "dark:bg-secondary/50 dark:shadow-none",
                    "data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:border-primary",
                ],
                variant === "utility" && [
                    "border-transparent bg-transparent text-muted-foreground",
                    "data-pressed:bg-accent data-pressed:text-accent-foreground",
                ]
            )}
        >
            {/* Only the content shrinks on press, so the key's hit area never moves */}
            <span className="flex h-full items-center justify-center transition-transform duration-100 group-data-pressed:scale-90 group-data-pressed:duration-0">
                {children}
            </span>
        </button>
    );
};

/** On-screen keypad for the admin PIN; `onChange` receives the new code after every key. */
export const CodeNumberpad = ({ value, onChange }: { value: string; onChange: (pin: string) => void }) => {
    const full = value.length >= PIN_LENGTH;
    const empty = value.length === 0;
    const type = (digit: string) => {
        if (!full) onChange(value + digit);
    };

    const digitKey = (digit: string) => (
        <PadKey key={digit} onPress={() => type(digit)} disabled={full}>
            <span className="text-3xl font-medium tabular-nums">{digit}</span>
        </PadKey>
    );

    return (
        <div className="mt-3 grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digitKey)}
            <PadKey onPress={() => onChange("")} disabled={empty} variant="utility" label="Clear">
                <span className="text-base font-semibold tracking-wide uppercase">Clear</span>
            </PadKey>
            {digitKey("0")}
            <PadKey onPress={() => onChange(value.slice(0, -1))} disabled={empty} variant="utility" label="Delete last digit">
                <Delete className="h-7 w-7" />
            </PadKey>
        </div>
    );
};
