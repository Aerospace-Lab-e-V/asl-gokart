/*
 * Front view of the DRL pods, traced from photos of the kart. Each side has an upper strip running
 * diagonally from the inner end (bumper centre, where the wires enter) up to the outer end, and a lower,
 * nearly horizontal strip. Both are wired in parallel, so both show the same 15 LEDs.
 * Coordinates are in a FRONT_VIEW box; the right side of the drawing is the mirror image.
 */

export const FRONT_VIEW = { w: 400, h: 150 } as const;

type Pt = { x: number; y: number };
interface Strip {
    inner: Pt;
    outer: Pt;
}

/** Pod on the left of the drawing (seen from the front, that is the kart's right side). */
const LEFT_POD: Strip[] = [
    { inner: { x: 124, y: 108 }, outer: { x: 30, y: 30 } }, // upper, diagonal
    { inner: { x: 130, y: 126 }, outer: { x: 34, y: 98 } }, // lower, nearly horizontal
];

const mirror = (s: Strip): Strip => ({
    inner: { x: FRONT_VIEW.w - s.inner.x, y: s.inner.y },
    outer: { x: FRONT_VIEW.w - s.outer.x, y: s.outer.y },
});

export const PODS = { left: LEFT_POD, right: LEFT_POD.map(mirror) } as const;

/** Position of LED i (0 = inner end) of n on a strip. */
export function ledPosition(s: Strip, i: number, n: number): Pt {
    const k = (i + 0.5) / n;
    return { x: s.inner.x + (s.outer.x - s.inner.x) * k, y: s.inner.y + (s.outer.y - s.inner.y) * k };
}

/** Outline of the bumper nose around the pods, drawn faintly for context. */
export const BUMPER_PATH =
    "M 14 22 Q 18 8 34 14 L 150 78 Q 200 96 250 78 L 366 14 Q 382 8 386 22 L 380 128 Q 376 144 352 144 L 48 144 Q 24 144 20 128 Z";
