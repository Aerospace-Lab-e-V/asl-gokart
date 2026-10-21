import React from "react";
import { createTelltale, Line } from "./create-telltale";
import { LAMP, MIRROR, fogWave } from "./shapes";

export const LowBeam = createTelltale(
    "LowBeam",
    <>
        <path d={LAMP} />
        <Line>
            <path d="M9 6 2.5 8.5M9 10l-6.5 2.5M9 14l-6.5 2.5M9 18l-6.5 2.5" />
        </Line>
    </>
);

export const HighBeam = createTelltale(
    "HighBeam",
    <>
        <path d={LAMP} />
        <Line>
            <path d="M9 6H2.5M9 10H2.5M9 14H2.5M9 18H2.5" />
        </Line>
    </>
);

export const FrontFogLight = createTelltale(
    "FrontFogLight",
    <>
        <path d={LAMP} />
        <Line>
            <path d="M9.5 6.5 2.5 9M9.5 12l-7 2.5M9.5 17.5l-7 2.5" />
            <path d={fogWave(6)} strokeWidth={1.75} />
        </Line>
    </>
);

export const RearFogLight = createTelltale(
    "RearFogLight",
    <>
        <path d={LAMP} transform={MIRROR} />
        <Line>
            <path d="M15 7h6.5M15 12h6.5M15 17h6.5" />
            <path d={fogWave(18.25)} strokeWidth={1.75} />
        </Line>
    </>
);

/** Position / tail lights: two small lamps back to back, shining outwards. */
export const ParkingLights = createTelltale(
    "ParkingLights",
    <>
        <path d="M8 8h.5a3 4 0 0 1 0 8H8z" />
        <path d="M8 8h.5a3 4 0 0 1 0 8H8z" transform={MIRROR} />
        <Line>
            <path d="M6 9 2.5 7.5M6 12H2M6 15l-3.5 1.5" />
            <path d="M18 9l3.5-1.5M18 12h4M18 15l3.5 1.5" />
        </Line>
    </>
);

export const DaytimeRunningLights = createTelltale(
    "DaytimeRunningLights",
    <>
        <path d={LAMP} />
        <Line>
            <path d="M8.5 7.5 5 5M8.5 12h-5M8.5 16.5 5 19" />
        </Line>
    </>
);

export const AutoHeadlights = createTelltale(
    "AutoHeadlights",
    <>
        <path d={LAMP} />
        <Line>
            <path d="M9 6 2.5 8.5M9 10l-6.5 2.5M9 14l-6.5 2.5M9 18l-6.5 2.5" />
        </Line>
    </>,
    <Line strokeWidth={1.6}>
        <path d="m13.9 15.5 2.6-7 2.6 7M14.8 13.2h3.4" />
    </Line>
);

export const TurnSignalLeft = createTelltale(
    "TurnSignalLeft",
    <path
        d="M3 12l7-7v4h11v6H10v4z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
    />
);

export const TurnSignalRight = createTelltale(
    "TurnSignalRight",
    <path
        d="M3 12l7-7v4h11v6H10v4z"
        transform={MIRROR}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
    />
);

export const HazardLights = createTelltale(
    "HazardLights",
    <Line>
        <path d="M12 3 22 20H2z" />
        <path d="M12 9.8 16 16.6H8z" />
    </Line>
);
