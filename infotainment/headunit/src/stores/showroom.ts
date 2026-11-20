import { create } from "zustand";
import { findAnimation, welcomeTotalMs } from "@/domain/lights";
import { send } from "@/services/commands";
import { useSession } from "@/stores/session";
import { readSignal } from "@/stores/signals";

/*
 * Showroom mode: replays the welcome on the kart every few seconds, for exhibition booths.
 * Runs on the headunit only and is never stored, so a kart that reboots never comes back up looping.
 * Every play goes through the normal command (standstill check in main, safety check in zc_lights);
 * the first refusal stops the loop.
 */

interface ShowroomState {
    looping: boolean;
    /** Pause between two welcomes, s. */
    pauseS: number;
    /** Why the loop stopped by itself. */
    error: string | null;
}

export const useShowroom = create<ShowroomState>(() => ({ looping: false, pauseS: 10, error: null }));

let timer: ReturnType<typeof setTimeout> | null = null;

function clear(): void {
    if (timer) clearTimeout(timer);
    timer = null;
}

/** How long one welcome with the current settings takes. */
function welcomeMs(): number {
    const front = findAnimation("front", readSignal("lights.welcome_front"));
    const rear = findAnimation("rear", readSignal("lights.welcome_rear"));
    return front && rear ? welcomeTotalMs(front, rear) : 5000;
}

async function playAndSchedule(): Promise<void> {
    clear();
    if (!useShowroom.getState().looping) return;
    const result = await send({ type: "lights.welcome" });
    if (!useShowroom.getState().looping) return;
    if (!result.ok) {
        useShowroom.setState({ looping: false, error: result.error });
        return;
    }
    timer = setTimeout(playAndSchedule, welcomeMs() + useShowroom.getState().pauseS * 1000);
}

export function setLooping(looping: boolean): void {
    clear();
    useShowroom.setState({ looping, error: null });
    if (looping) void playAndSchedule();
}

export const setPause = (pauseS: number) => useShowroom.setState({ pauseS });

// Locking admin mode ends the show.
useSession.subscribe((s) => {
    if (!s.adminMode && useShowroom.getState().looping) setLooping(false);
});
