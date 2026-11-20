import React from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCommand } from "@/services/commands";
import { useSession } from "@/stores/session";
import { useSignal } from "@/stores/signals";
import { cn } from "@/lib/utils";

/** Below this speed (km/h) the kart counts as standing still; as main/standstill.ts. */
const STANDSTILL_KMH = 0.5;

/** Why the welcome cannot be played right now, or null. Main and zc_lights check again. */
export function useWelcomeBlocker(): string | null {
    const front = useSignal("lights.welcome_front");
    const catalog = useSignal("lights.front_anims");
    const playing = useSignal("lights.welcome_playing");
    const speed = useSignal("drive.speed");
    const admin = useSession((s) => s.adminMode);

    if (catalog === 0) return "zc_lights firmware too old";
    if (front === null) return "zc_lights not connected";
    if (playing === 1) return "Playing…";
    if (speed === null) return admin ? null : "No speed from the motor controller";
    if (Math.abs(speed) >= STANDSTILL_KMH) return "Stop the kart to play it";
    return null;
}

/** Plays the welcome on the kart. */
export function PlayWelcomeButton({ className, showReason = true }: { className?: string; showReason?: boolean }) {
    const blocker = useWelcomeBlocker();
    const { run, pending } = useCommand();

    const play = async () => {
        const result = await run({ type: "lights.welcome" });
        if (!result.ok) toast.error(`Could not play the welcome: ${result.error}`);
    };

    return (
        <div className={cn("flex flex-col items-center gap-2", className)}>
            <Button variant="secondary" className="h-14 rounded-full px-8 text-xl" disabled={!!blocker || pending} onClick={play}>
                <Play className="mr-3 h-6 w-6" aria-hidden />
                Play welcome
            </Button>
            {showReason && <span className="text-muted-foreground h-7 text-lg" aria-live="polite">{blocker}</span>}
        </div>
    );
}
