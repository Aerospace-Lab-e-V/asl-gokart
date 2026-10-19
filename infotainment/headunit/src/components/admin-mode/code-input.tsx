import {
    InputOTP,
    InputOTPGroup,
  } from "@/components/ui/input-otp"
import { useStore } from "@/stores/useStore";
import { REGEXP_ONLY_DIGITS, OTPInputContext } from "input-otp";
import { toast } from "sonner"
import log from "@/lib/logger";
import React from "react";
import { cn } from "@/lib/utils";

const MaskedOTPSlot = React.forwardRef<
    React.ElementRef<"div">,
    React.ComponentPropsWithoutRef<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
    const inputOTPContext = React.useContext(OTPInputContext);
    const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index];

    return (
        <div
            ref={ref}
            className={cn(
                "relative flex h-14 w-12 items-center justify-center border-y border-r border-zinc-700 bg-zinc-900 transition-all first:rounded-l-xl first:border-l last:rounded-r-xl",
                isActive && "z-10 ring-2 ring-ring",
                className
            )}
            {...props}
        >
            {char && <span className="font-mono text-xl font-bold text-zinc-100">•</span>}
            {hasFakeCaret && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-4 w-px animate-caret-blink bg-zinc-100 duration-1000" />
                </div>
            )}
        </div>
    );
});
MaskedOTPSlot.displayName = "MaskedOTPSlot";

export const CodeInput = () => {

    const { adminPin, setAdminMode, setAdminPin } = useStore();

    const PIN = "69420";

    const handleLogin = (pin: string) => {
        if (pin === PIN) {
            setAdminMode(true);
            toast("Admin mode enabled!");
        } else {
            log.error("Wrong PIN!");
            toast.error("Wrong PIN!");
            // Clear the code so the next attempt can be typed right away.
            setAdminPin("");
        }
    };

    return (
        <InputOTP
            maxLength={5}
            pattern={REGEXP_ONLY_DIGITS}
            onComplete={(value) => handleLogin(value)}
            value={adminPin}
        >
            <InputOTPGroup className="gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                    <MaskedOTPSlot key={i} index={i} />
                ))}
            </InputOTPGroup>
        </InputOTP>
    );
}
