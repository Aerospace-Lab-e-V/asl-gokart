import React from "react";
import { fmt } from "@/components/drive/format";
import { useSignal } from "@/stores/signals";
import { cn } from "@/lib/utils";

/** Speed readout; `className` sets the size of the number. */
export const Speed = ({ className = "text-[10rem]" }: { className?: string }) => {
    const speed = useSignal("drive.speed");
    return (
        <div className="flex flex-col items-center">
            {/* Size first: tailwind-merge drops a leading-* that comes before a font size. */}
            <p className={cn(className, "leading-none tracking-tight tabular-nums")}>{fmt(speed)}</p>
            <p className="text-2xl text-muted-foreground">km/h</p>
        </div>
    );
};
