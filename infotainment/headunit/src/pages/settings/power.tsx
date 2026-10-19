import React, { useEffect, useState } from "react";
import { LucideIcon, Maximize2, Minimize2, X } from "lucide-react";
import { Subpage } from "@/components/shared/subpage";
import { cn } from "@/lib/utils";

/** How long "Close app" stays armed after the first tap. */
const CONFIRM_MS = 3000;

const PowerPage = () => {
    const [closeArmed, setCloseArmed] = useState(false);

    useEffect(() => {
        if (!closeArmed) return;
        const timer = setTimeout(() => setCloseArmed(false), CONFIRM_MS);
        return () => clearTimeout(timer);
    }, [closeArmed]);

    // Closing takes the dashboard away from the driver, so it needs a second tap.
    const close = () => (closeArmed ? window.electronWindow.close() : setCloseArmed(true));

    return (
        <Subpage title="Power" description="Window controls for the headunit app" backTo="/settings" className="justify-center">
            <div className="grid grid-cols-3 gap-6">
                <PowerTile icon={Minimize2} label="Minimize" onClick={() => window.electronWindow.minimize()} />
                <PowerTile icon={Maximize2} label="Maximize" onClick={() => window.electronWindow.maximize()} />
                <PowerTile
                    icon={X}
                    label={closeArmed ? "Tap again to close" : "Close app"}
                    destructive
                    armed={closeArmed}
                    onClick={close}
                />
            </div>
        </Subpage>
    );
};

type PowerTileProps = {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    destructive?: boolean;
    armed?: boolean;
};

const PowerTile = ({ icon: Icon, label, onClick, destructive, armed }: PowerTileProps) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            "flex h-48 flex-col items-center justify-center gap-4 rounded-xl border-2 text-xl font-medium transition-colors",
            "active:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            // Raw reds: the theme's destructive red is too dark to read on the dark background.
            destructive && "border-red-500/60 text-red-500",
            armed && "border-red-600 bg-red-600 text-white active:bg-red-700"
        )}
    >
        <Icon className="h-12 w-12" aria-hidden />
        <span aria-live="polite">{label}</span>
    </button>
);

export default PowerPage;
