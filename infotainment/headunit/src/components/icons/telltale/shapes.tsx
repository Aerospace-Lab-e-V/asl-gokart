import React from "react";
import { Line } from "./create-telltale";

// Shared parts of the telltales, all on the 24x24 grid.

/** Headlamp body: flat lens on the left, rounded back on the right. Beams go to the left of x=10. */
export const LAMP = "M12.5 5h1c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7h-1c-.8 0-1.5-3.1-1.5-7s.7-7 1.5-7z";

/** Mirrors a glyph horizontally (for rear-facing lamps and right-hand arrows). */
export const MIRROR = "matrix(-1 0 0 1 24 0)";

/** Wavy line crossing the beams of fog lamps, centred on `x`. */
export const fogWave = (x: number) => `M${x} 3.5q-1.6 2 0 4t0 4 0 4 0 4`;

/** "!" sized to sit inside a shape. `top`/`bottom` are the ends of the bar; the dot sits below. */
export const Exclamation = ({
    x = 12,
    top,
    bottom,
    width = 2,
}: {
    x?: number;
    top: number;
    bottom: number;
    width?: number;
}) => (
    <>
        <Line strokeWidth={width}>
            <path d={`M${x} ${top}V${bottom}`} />
        </Line>
        <circle cx={x} cy={bottom + width + 0.1} r={width * 0.55} />
    </>
);

/** Circle with an arc on each side - the frame of the brake, parking brake and ABS lamps. */
export const BrakeFrame = () => (
    <Line>
        <circle cx="12" cy="12" r="6.25" />
        <path d="M4.5 5.7a9.75 9.75 0 0 0 0 12.6M19.5 5.7a9.75 9.75 0 0 1 0 12.6" />
    </Line>
);

/** Battery box with two terminals. Body spans y 7..19.5, terminals at x 6.75 and 17.25. */
export const Battery = () => (
    <>
        <rect x="2.5" y="7" width="19" height="12.5" rx="1.5" />
        <rect x="5" y="4.5" width="3.5" height="3" rx=".5" />
        <rect x="15.5" y="4.5" width="3.5" height="3" rx=".5" />
    </>
);

/** Electric motor, side view: terminal box on top, end cap and shaft to the right, feet below. */
export const Motor = () => (
    <>
        <rect x="2.5" y="7" width="13.5" height="10" rx="1.5" />
        <rect x="6.5" y="4.5" width="5.5" height="3" rx=".5" />
        <rect x="15" y="9" width="3" height="6" rx=".75" />
        <rect x="17" y="11" width="4.5" height="2" rx=".5" />
        <path d="M4.5 16.5h9.5l1 3H3.5z" />
    </>
);

/** Thermometer meant as a knockout: stem from `top` down into a bulb centred at (x, bulbY). */
export const Thermometer = ({ x, top, bulbY }: { x: number; top: number; bulbY: number }) => (
    <>
        <Line strokeWidth={1.6}>
            <path d={`M${x} ${top}V${bulbY}`} />
        </Line>
        <circle cx={x} cy={bulbY} r="1.8" />
    </>
);

/** Car seen from the side, facing right, spanning y 4..16. */
export const CarSide = () => (
    <>
        <path d="M2.5 13.5v-2.3c0-.8.5-1.4 1.3-1.6L7 8.8l2.6-3c.4-.5 1-.8 1.7-.8H16c.7 0 1.3.3 1.7.8l2.5 3c.8.2 1.3.9 1.3 1.7v3c0 .55-.45 1-1 1h-17c-.55 0-1-.45-1-1z" />
        <circle cx="7" cy="14.5" r="2.1" />
        <circle cx="17" cy="14.5" r="2.1" />
    </>
);

/** Knockout for CarSide: side windows and the gap around the wheels. */
export const CarSideCutouts = () => (
    <>
        <path d="M10.6 6.6 8.8 8.8h3.9V6.6zM14.2 6.6v2.2h4.1l-1.8-2.2z" />
        <Line strokeWidth={1.1}>
            <circle cx="7" cy="14.5" r="2.75" />
            <circle cx="17" cy="14.5" r="2.75" />
        </Line>
    </>
);
