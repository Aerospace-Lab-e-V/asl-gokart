import React from "react";
import { createTelltale, Line } from "./create-telltale";
import { Exclamation } from "./shapes";

export const Seatbelt = createTelltale(
    "Seatbelt",
    <>
        <circle cx="12" cy="5" r="2.75" />
        <path d="M5.5 21v-6.5c0-3 2.5-5.5 5.5-5.5h2c3 0 5.5 2.5 5.5 5.5V21z" />
    </>,
    <Line strokeWidth={1.1}>
        <path d="M14.2 9.2 6.4 19.6M17.1 10.6 9.4 21" />
        <circle cx="7.6" cy="19" r="1.6" fill="black" />
    </Line>
);

/** Door open: car from above with the front doors swung out. */
export const DoorOpen = createTelltale(
    "DoorOpen",
    <>
        <rect x="8" y="2.5" width="8" height="19" rx="3" />
        <Line strokeWidth={1.75}>
            <path d="M8 8.5 3.5 12M16 8.5l4.5 3.5" />
        </Line>
    </>,
    <path d="M9.5 9.25q2.5-1.1 5 0l-.5 2.25h-4zM10 16.25h4l.5 2.25q-2.5 1.1-5 0z" />
);

/** Tyre pressure: tyre cross-section with "!". */
export const TirePressure = createTelltale(
    "TirePressure",
    <>
        <Line>
            <path d="M6 4C3.8 7.2 3.6 12.8 5 16.5l.5 2.5h13l.5-2.5C20.4 12.8 20.2 7.2 18 4" />
            <path d="M7.5 19v2.25M10.5 19v2.25M13.5 19v2.25M16.5 19v2.25" />
        </Line>
        <Exclamation top={7} bottom={12} />
    </>
);

/** Service due: spanner. */
export const ServiceDue = createTelltale(
    "ServiceDue",
    <>
        <Line strokeWidth={3.5}>
            <path d="M5 19l9-9" />
        </Line>
        <circle cx="15.75" cy="8.25" r="5" />
    </>,
    <>
        <Line strokeWidth={3}>
            <path d="M16 8l6-6" />
        </Line>
        <circle cx="5.25" cy="18.75" r=".9" />
    </>
);

export const CruiseControl = createTelltale(
    "CruiseControl",
    <>
        <Line>
            <path d="M5.3 18.5a8.5 8.5 0 1 1 13.4 0" />
            <path d="M12 14.5 16 10" />
        </Line>
        <Line strokeWidth={1.5}>
            <path d="M12 7v1.5M7.05 9.55l1.05 1.05M5.5 14.5h1.5M17 14.5h1.5" />
        </Line>
        <circle cx="12" cy="14.5" r="2" />
    </>
);

export const EcoMode = createTelltale(
    "EcoMode",
    <>
        <path d="M6.5 18.5C5.5 10.5 10.5 4 20.5 3.5c.5 9.5-5.5 15.5-14 15z" />
        <Line strokeWidth={1.75}>
            <path d="M3.5 21.5 7 18" />
        </Line>
    </>,
    <Line strokeWidth={1.25}>
        <path d="M7 18 17 7.5M11.5 13.3V10M14 10.6l3 .2" />
    </Line>
);

/** Key / immobilizer: key not detected or not authorised. */
export const Key = createTelltale(
    "Key",
    <>
        <circle cx="7" cy="12" r="4.75" />
        <rect x="10.5" y="10.75" width="11" height="2.5" rx=".75" />
        <rect x="15.5" y="12.5" width="1.75" height="3.25" rx=".5" />
        <rect x="18.75" y="12.5" width="1.75" height="2.5" rx=".5" />
    </>,
    <circle cx="6.25" cy="12" r="1.75" />
);
