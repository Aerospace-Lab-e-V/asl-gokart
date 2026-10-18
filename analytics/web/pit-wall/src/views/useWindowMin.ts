import { useSearch } from "@tanstack/react-router";
import { DEFAULT_WINDOW_MIN, type WindowMin } from "./presets";

/** Chart window of the kart view, from `?window=`; absent means the default. */
export function useWindowMin(): WindowMin {
    return useSearch({ from: "/kart/$kartId", select: (s) => s.window ?? DEFAULT_WINDOW_MIN });
}
