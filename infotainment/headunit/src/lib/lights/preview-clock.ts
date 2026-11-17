/*
 * One requestAnimationFrame loop for every light preview on screen, capped at FPS so the
 * Raspberry Pi 4 (no WebGL, Canvas 2D only) keeps up. Stops while nothing is subscribed or the
 * window is hidden.
 */

export const FPS = 30;
const FRAME_MS = 1000 / FPS;

type FrameFn = (now: number) => void;

const subscribers = new Set<FrameFn>();
let raf: number | null = null;
let last = 0;

function tick(now: number): void {
    raf = null;
    if (subscribers.size === 0) return;
    if (!document.hidden && now - last >= FRAME_MS - 1) {
        last = now;
        const t = performance.timeOrigin + now; // epoch ms, comparable with signal timestamps
        subscribers.forEach((fn) => fn(t));
    }
    raf = requestAnimationFrame(tick);
}

/** Calls `fn(epochMs)` up to FPS times a second; returns the unsubscribe function. */
export function subscribeFrame(fn: FrameFn): () => void {
    subscribers.add(fn);
    if (raf === null) raf = requestAnimationFrame(tick);
    return () => {
        subscribers.delete(fn);
        if (subscribers.size === 0 && raf !== null) {
            cancelAnimationFrame(raf);
            raf = null;
        }
    };
}
