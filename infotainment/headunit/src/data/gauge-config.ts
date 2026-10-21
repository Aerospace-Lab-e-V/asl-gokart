
export interface Segment {
    value: number;
    color: string;
}

export const THROTTLE_BOUNDARIES: [number, number] = [0, 100];
export const RPM_BOUNDARIES: [number, number] = [0, 1500];

const WARN = "#f59e0b"; // amber-500
const LIMIT = "#ef4444"; // red-500

/** Neutral (fg) through the normal range, blending to amber then red near the limit. */
export const throttleSegments = (fg: string): Segment[] => [
    { value: 0, color: fg },
    { value: 50, color: fg },
    { value: 70, color: WARN },
    { value: 100, color: LIMIT },
];

export const rpmSegments = (fg: string): Segment[] => [
    { value: 0, color: fg },
    { value: 750, color: fg },
    { value: 1000, color: WARN },
    { value: 1500, color: LIMIT },
];
