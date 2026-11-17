import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Kart position on the map, always pointing up (the map turns underneath). */
export const KartArrow = ({ dim = false }: { dim?: boolean }) => (
    <svg
        viewBox="0 0 24 24"
        className={cn("size-9 text-foreground transition-opacity duration-500", dim && "opacity-30")}
        aria-hidden
    >
        <path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="currentColor" stroke="hsl(var(--background))" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
);

/** Two rings pulsing out of the arrow while the first tiles load; transform and opacity only, for the Pi. */
export const MapLoader = () => (
    <div role="status" className="flex flex-col items-center gap-y-6">
        <div className="relative flex size-40 items-center justify-center">
            <span className="absolute inset-0 animate-map-ping rounded-full border-2 border-foreground/50 motion-reduce:hidden" />
            <span className="absolute inset-0 animate-map-ping rounded-full border-2 border-foreground/50 [animation-delay:1s] motion-reduce:hidden" />
            <KartArrow />
        </div>
        <p className="text-lg text-muted-foreground">Loading map…</p>
    </div>
);

/** Why there is no map, in the Drive page's muted label style. */
export const MapPlaceholder = ({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail?: string }) => (
    <div role="status" className="flex max-w-xs flex-col items-center gap-y-3 text-center text-muted-foreground">
        <Icon className="size-12" strokeWidth={1.5} />
        <p className="text-lg">{title}</p>
        {detail && <p className="text-lg tabular-nums">{detail}</p>}
    </div>
);
