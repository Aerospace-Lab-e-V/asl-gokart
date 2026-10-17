export interface AdcStatusData {
    max: number;
    min: number;
    value: number;
}

export interface LedCommandData {
    on: boolean;
    sequence?: number;
}

export interface TinybufStatus {
    available: boolean;
    status: string;
    runLevel: number;
}

// Aliases for message-centric terminology
export type AdcStatusMessage = AdcStatusData;
export type LedCommandMessage = LedCommandData;
