import { InputOTP, InputOTPGroup } from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS, OTPInputContext } from "input-otp";
import React from "react";
import { cn } from "@/lib/utils";

const PIN_LENGTH = 5;

/** One box of the PIN: a dot once filled, highlighted when it takes the next digit. */
const MaskedSlot = ({ index }: { index: number }) => {
    const { slots } = React.useContext(OTPInputContext);
    const filled = Boolean(slots[index].char);
    // The keypad never focuses the hidden input, so input-otp's own isActive stays false:
    // the next box is the first empty one.
    const next = !filled && slots.findIndex((s) => !s.char) === index;

    return (
        <div
            className={cn(
                "flex h-16 w-14 items-center justify-center rounded-xl border-2 transition-colors duration-150",
                filled && "border-foreground/40 bg-card dark:bg-secondary/50",
                next && "border-foreground bg-card dark:bg-secondary/50",
                !filled && !next && "border-border bg-muted/50 dark:bg-transparent"
            )}
        >
            <span
                className={cn(
                    "bg-foreground h-3.5 w-3.5 rounded-full transition-transform duration-150",
                    filled ? "scale-100" : "scale-0"
                )}
            />
        </div>
    );
};

/** Shows the PIN typed on the numberpad; `onComplete` fires once all digits are in. */
export const CodeInput = ({ value, onComplete }: { value: string; onComplete: (pin: string) => void }) => (
    <InputOTP maxLength={PIN_LENGTH} pattern={REGEXP_ONLY_DIGITS} onComplete={onComplete} value={value}>
        <InputOTPGroup className="gap-3" aria-label={`${value.length} of ${PIN_LENGTH} digits entered`}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <MaskedSlot key={i} index={i} />
            ))}
        </InputOTPGroup>
    </InputOTP>
);
