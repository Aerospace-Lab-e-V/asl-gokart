import { useEffect, useRef, useState } from "react";
import { emaStep, holdRounded } from "@/lib/utils/smoothing";

/** How often the average takes the current value; also the longest the shown value lags a change. */
const STEP_MS = 250;
/** How far the average must move off the shown number before it changes. */
const BAND = 0.75;

/**
 * `value` averaged over about `tauMs` and shown as a steady whole number, for readings that jitter between
 * neighbouring values (the Kelly controllers report whole °C and flip e.g. 12/14 several times a second).
 * The average samples on a fixed clock, so a value that holds still pulls it in too. null shows null at once.
 */
export function useSmoothed(value: number | null, tauMs = 2000): number | null {
    const latest = useRef(value);
    const avg = useRef<number | null>(null);
    const [shown, setShown] = useState<number | null>(value === null ? null : Math.round(value));

    useEffect(() => {
        latest.current = value;
    }, [value]);

    useEffect(() => {
        const id = setInterval(() => {
            const v = latest.current;
            const next = v === null ? null : avg.current === null ? v : emaStep(avg.current, v, STEP_MS, tauMs);
            avg.current = next;
            setShown((s) => (next === null ? null : holdRounded(s, next, BAND)));
        }, STEP_MS);
        return () => clearInterval(id);
    }, [tauMs]);

    return value === null ? null : shown;
}
