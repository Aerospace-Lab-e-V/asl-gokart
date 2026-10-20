import { Delete } from "lucide-react";
import log from "@/lib/logger";
import React from "react";
import { cn } from "@/lib/utils";

const PadButton = ({
    children,
    onClick,
    disabled,
    variant = "digit",
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    variant?: "digit" | "utility";
}) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
            "flex h-[76px] w-full select-none items-center justify-center rounded-xl",
            "border font-mono font-bold transition-[transform,background-color,border-color]",
            "duration-75 active:scale-[0.90] active:duration-[40ms]",
            "disabled:pointer-events-none disabled:opacity-25",
            variant === "digit" && [
                "border-zinc-700 bg-zinc-900 text-2xl text-zinc-100",
                "hover:border-zinc-600 hover:bg-zinc-800",
                "active:border-amber-500/50 active:bg-amber-500/15",
            ],
            variant === "utility" && [
                "border-input bg-muted/60 text-lg text-muted-foreground",
                "hover:bg-muted hover:text-foreground",
                "active:bg-accent active:text-accent-foreground",
            ]
        )}
    >
        {children}
    </button>
);

export const CodeNumberpad = ({ value: adminPin, onChange: setAdminPin }: { value: string; onChange: (pin: string) => void }) => {

    const handleAdminPinChange = (value: string, removingChar: boolean) => {
        if (removingChar) {
            if (adminPin.length > 0) {
                setAdminPin(value);
            } else {
                log.error("Admin Pin is already empty!");
            }
        } else {
            if (adminPin.length < 5) {
                setAdminPin(value);
            } else {
                log.error("Admin Pin is already 5 digits long!");
            }
        }
    };

    return (
        <div className="grid grid-cols-3 gap-2.5 mt-3">
            {Array.from(Array(9).keys()).map((i) => (
                <PadButton
                    key={i + 1}
                    onClick={() => handleAdminPinChange(adminPin + (i + 1).toString(), false)}
                    disabled={adminPin.length >= 5}
                >
                    {i + 1}
                </PadButton>
            ))}
            <PadButton
                onClick={() => setAdminPin("")}
                disabled={adminPin.length === 0}
                variant="utility"
            >
                CLR
            </PadButton>
            <PadButton
                onClick={() => handleAdminPinChange(adminPin + "0", false)}
                disabled={adminPin.length >= 5}
            >
                0
            </PadButton>
            <PadButton
                onClick={() => handleAdminPinChange(adminPin.slice(0, -1), true)}
                disabled={adminPin.length === 0}
                variant="utility"
            >
                <Delete className="h-5 w-5" />
            </PadButton>
        </div>
    );
}