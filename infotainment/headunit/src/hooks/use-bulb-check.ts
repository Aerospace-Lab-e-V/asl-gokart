import { useEffect, useState } from "react";

/** How long every warning lamp lights up for the bulb check. */
export const BULB_CHECK_MS = 5000;

let done = false;

/**
 * True for the first BULB_CHECK_MS the Drive page is shown after the app starts, like a car lighting all its
 * lamps at ignition. Opening the page again later does not repeat it.
 */
export function useBulbCheck(): boolean {
    const [checking, setChecking] = useState(!done);

    useEffect(() => {
        if (!checking) return;
        done = true;
        const id = setTimeout(() => setChecking(false), BULB_CHECK_MS);
        return () => clearTimeout(id);
    }, [checking]);

    return checking;
}

/** Lets the next mount run the bulb check again; for tests. */
export const resetBulbCheck = () => {
    done = false;
};
