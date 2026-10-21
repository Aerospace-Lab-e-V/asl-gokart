import React from "react";
import { createTelltale, Line } from "./create-telltale";
import {
    Battery,
    CarSide,
    CarSideCutouts,
    Exclamation,
    Motor,
    Thermometer,
} from "./shapes";

/** Traction (HV) battery fault. */
export const HvBatteryFault = createTelltale(
    "HvBatteryFault",
    <Battery />,
    <Exclamation top={9.5} bottom={13.5} />
);

export const BatteryTemperature = createTelltale(
    "BatteryTemperature",
    <Battery />,
    <>
        <Thermometer x={12} top={9.25} bulbY={15.75} />
        <Line strokeWidth={1.4}>
            <path d="M14 10h1.75M14 12.5h1.75" />
        </Line>
    </>
);

/** Electric drive / motor fault. */
export const MotorFault = createTelltale(
    "MotorFault",
    <Motor />,
    <Exclamation x={9.25} top={9} bottom={12.25} width={1.8} />
);

export const MotorTemperature = createTelltale(
    "MotorTemperature",
    <Motor />,
    <Thermometer x={9.25} top={8.75} bulbY={13.75} />
);

/** Motor controller / inverter fault: the DC-to-AC converter symbol. */
export const InverterFault = createTelltale(
    "InverterFault",
    <rect x="3" y="3" width="18" height="18" rx="2.5" />,
    <Line strokeWidth={1.6}>
        <path d="M19 5 5 19" />
        <path d="M6 8h4.5M6 10.75h4.5" />
        <path d="M13.25 15.75q1.3-1.7 2.6 0t2.6 0" />
    </Line>
);

/** Ready to drive: car with a double arrow. */
export const ReadyToDrive = createTelltale(
    "ReadyToDrive",
    <>
        <CarSide />
        <Line strokeWidth={1.75}>
            <path d="M4.5 20.5h15M7 18.5l-2.5 2 2.5 2M17 18.5l2.5 2-2.5 2" />
        </Line>
    </>,
    <CarSideCutouts />
);

export const Charging = createTelltale(
    "Charging",
    <>
        <rect x="8.75" y="2.5" width="2" height="5.5" rx=".75" />
        <rect x="13.25" y="2.5" width="2" height="5.5" rx=".75" />
        <path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z" />
        <Line>
            <path d="M12 15.5v2.75c0 1.5 1 2.75 2.75 2.75h5.75" />
        </Line>
    </>,
    <Line strokeWidth={1.3}>
        <path d="m12.8 8.9-1.9 2.6h2.2l-1.9 2.6" />
    </Line>
);

/** Reduced power / limp mode (the turtle). */
export const PowerLimited = createTelltale(
    "PowerLimited",
    <>
        <path d="M2 15.5a7.75 7 0 0 1 15.5 0z" />
        <rect x="15" y="12.5" width="3.5" height="2.5" />
        <ellipse cx="19.25" cy="12.75" rx="2.75" ry="2.25" />
        <rect x="4" y="15" width="3" height="3.5" rx="1" />
        <rect x="12.5" y="15" width="3" height="3.5" rx="1" />
        <path d="M2.5 14.5 1 16h2z" />
    </>,
    <Line strokeWidth={1.1}>
        <path d="M3.5 13.25h12.5" />
        <path d="M7.25 13.25 8.5 10.5h2.5l1.25 2.75M8.5 10.5l-1.6-1.8M11 10.5l1.6-1.8" />
    </Line>
);

/** High-voltage / isolation fault: warning triangle with a lightning bolt. */
export const HighVoltage = createTelltale(
    "HighVoltage",
    <>
        <Line>
            <path d="M12 3.5 21.5 20h-19z" />
        </Line>
        <path d="M12.9 8.5 9.4 13.6h2.6l-1 4.4 3.6-5.3H12z" />
    </>
);
