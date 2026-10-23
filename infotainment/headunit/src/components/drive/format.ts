/** Telemetry value as text; null (no sample or stale) is "--". */
export const fmt = (value: number | null, digits = 0): string => (value === null ? "--" : value.toFixed(digits));

/** Mean of the values that are known; null when none is. */
export function avg(...values: (number | null)[]): number | null {
    const known = values.filter((v): v is number => v !== null);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

/** Highest of the values that are known; null when none is. */
export function highest(...values: (number | null)[]): number | null {
    const known = values.filter((v): v is number => v !== null);
    return known.length ? Math.max(...known) : null;
}
