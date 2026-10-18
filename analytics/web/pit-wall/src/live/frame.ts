type FrameCallback = (now: number) => void;

const callbacks = new Set<FrameCallback>();
let handle: number | null = null;

function loop(now: number): void {
    for (const cb of callbacks) cb(now);
    handle = callbacks.size > 0 ? requestAnimationFrame(loop) : null;
}

/**
 * Runs `cb` once per animation frame until the returned function is called.
 * All charts share one requestAnimationFrame loop, so they redraw in the same frame.
 */
export function onFrame(cb: FrameCallback): () => void {
    callbacks.add(cb);
    handle ??= requestAnimationFrame(loop);
    return () => {
        callbacks.delete(cb);
    };
}
