import React from "react";
import { createTelltale, Line } from "./create-telltale";
import { Battery, BrakeFrame, Exclamation } from "./shapes";

/** Generic amber/red warning: triangle outline with "!". */
export const MasterWarning = createTelltale(
    "MasterWarning",
    <>
        <Line>
            <path d="M12 3.5 21.5 20h-19z" />
        </Line>
        <Exclamation top={9.5} bottom={13.75} />
    </>
);

export const CheckEngine = createTelltale(
    "CheckEngine",
    <>
        <rect x="8" y="4.5" width="6.5" height="2" rx=".75" />
        <rect x="10" y="6" width="2.5" height="3" />
        <path d="M6 9.5c0-.55.45-1 1-1h9c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1h-1.5l-1.5 2h-4.5l-1.5-2H7c-.55 0-1-.45-1-1z" />
        <rect x="3.5" y="11.5" width="3" height="2.5" />
        <rect x="2" y="9.5" width="2" height="7" rx=".75" />
        <path d="M16.5 10.5 20 8.6c.7-.4 1.5.1 1.5.9v7c0 .8-.8 1.3-1.5.9l-3.5-1.9z" />
    </>
);

/** Charging system / 12 V battery fault. */
export const BatteryFault = createTelltale(
    "BatteryFault",
    <Battery />,
    <Line strokeWidth={1.75}>
        <path d="M5 13.25h3.5M15.5 13.25H19M17.25 11.5V15" />
    </Line>
);

export const BrakeFault = createTelltale(
    "BrakeFault",
    <>
        <BrakeFrame />
        <Exclamation top={8.5} bottom={12.75} width={1.9} />
    </>
);

export const ParkingBrake = createTelltale(
    "ParkingBrake",
    <>
        <BrakeFrame />
        <Line strokeWidth={1.75}>
            <path d="M10.1 15.5v-7h2a1.9 1.9 0 0 1 0 3.8h-2" />
        </Line>
    </>
);

export const Abs = createTelltale(
    "Abs",
    <>
        <BrakeFrame />
        <Line strokeWidth={1.3}>
            <path d="m7.9 13.75 1.1-3.5 1.1 3.5M8.35 12.6h1.3" />
            <path d="M10.9 10.25h1a.875.875 0 0 1 0 1.75h-1m0 0h1.2a.875.875 0 0 1 0 1.75h-1.2zV10.25" />
            <path d="M16 10.6c-.3-.25-.65-.35-1-.35-.6 0-1.05.4-1.05.9 0 1.2 2.15.75 2.15 1.95 0 .5-.5.85-1.1.85-.45 0-.85-.15-1.1-.45" />
        </Line>
    </>
);

/** Transmission / gearbox fault: gear with "!". */
export const TransmissionFault = createTelltale(
    "TransmissionFault",
    <path d="M10.2 4.21L10.54 1.6L13.46 1.6L13.8 4.21A8 8 0 0 1 16.24 5.22L18.32 3.61L20.39 5.68L18.78 7.76A8 8 0 0 1 19.79 10.2L22.4 10.54L22.4 13.46L19.79 13.8A8 8 0 0 1 18.78 16.24L20.39 18.32L18.32 20.39L16.24 18.78A8 8 0 0 1 13.8 19.79L13.46 22.4L10.54 22.4L10.2 19.79A8 8 0 0 1 7.76 18.78L5.68 20.39L3.61 18.32L5.22 16.24A8 8 0 0 1 4.21 13.8L1.6 13.46L1.6 10.54L4.21 10.2A8 8 0 0 1 5.22 7.76L3.61 5.68L5.68 3.61L7.76 5.22A8 8 0 0 1 10.2 4.21Z" />,
    <Exclamation top={7.5} bottom={12.5} />
);

/** Traction / stability control: car from behind with skid marks. */
export const TractionControl = createTelltale(
    "TractionControl",
    <>
        <path d="M7.4 2.5h9.2c.4 0 .8.25.95.65L19.3 7H4.7l1.75-3.85c.15-.4.55-.65.95-.65z" />
        <rect x="3" y="6.5" width="18" height="6" rx="1.5" />
        <rect x="4" y="11.5" width="3.5" height="3" rx=".75" />
        <rect x="16.5" y="11.5" width="3.5" height="3" rx=".75" />
        <Line strokeWidth={1.75}>
            <path d="M8.5 16c-1.5 1-1.5 2.2 0 3.25s1.5 2.2 0 3.25" transform="translate(0 -1)" />
            <path d="M15.5 16c-1.5 1-1.5 2.2 0 3.25s1.5 2.2 0 3.25" transform="translate(0 -1)" />
        </Line>
    </>,
    <>
        <path d="M8 4h8l1.2 2.5H6.8z" />
        <rect x="4.75" y="8.25" width="3.25" height="1.75" rx=".5" />
        <rect x="16" y="8.25" width="3.25" height="1.75" rx=".5" />
    </>
);

export const OilPressure = createTelltale(
    "OilPressure",
    <>
        <rect x="6.5" y="7" width="6" height="1.5" rx=".5" />
        <rect x="8.25" y="8" width="2.5" height="3.5" />
        <path d="M4 11h9.5l7.2-3.1c.4-.15.75.3.5.65L15.5 17H5.5A1.5 1.5 0 0 1 4 15.5z" />
        <Line strokeWidth={1.75}>
            <path d="M4.5 12.25 2 10.5V9" />
        </Line>
        <path d="M21 12.5c.7 1 1.2 1.7 1.2 2.3a1.2 1.2 0 0 1-2.4 0c0-.6.5-1.3 1.2-2.3z" />
    </>
);

export const CoolantTemperature = createTelltale(
    "CoolantTemperature",
    <>
        <rect x="10.75" y="2.5" width="2.5" height="12" rx="1.25" />
        <circle cx="12" cy="14.5" r="3" />
        <Line>
            <path d="M15.5 4.5H18M15.5 7.5H18M15.5 10.5H18" />
            <path d="M2.5 16.5q1.25-1.2 2.5 0t2.5 0M16.5 16.5q1.25-1.2 2.5 0t2.5 0" />
            <path d="M2.5 20.5q1.58-1.4 3.17 0t3.17 0 3.17 0 3.17 0 3.17 0 3.17 0" />
        </Line>
    </>
);
