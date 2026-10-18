import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "pit-wall.theme";
const listeners = new Set<() => void>();

function initial(): Theme {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "light" || stored === "dark") return stored;
    } catch {
        // storage blocked: fall back to the OS setting
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let current: Theme = initial();
document.documentElement.dataset.theme = current;

export function setTheme(theme: Theme): void {
    current = theme;
    document.documentElement.dataset.theme = theme;
    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch {
        // not persisted; fine for this tab
    }
    for (const l of listeners) l();
}

export function useTheme(): Theme {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => current
    );
}

/**
 * Chart colours (canvas cannot read Tailwind classes). Categorical slots in fixed
 * order, validated for colour-vision deficiency; light and dark steps of the same hues.
 */
export const CHART_COLORS: Record<
    Theme,
    { series: readonly string[]; text: string; muted: string; grid: string }
> = {
    light: {
        series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
        text: "#52514e",
        muted: "#898781",
        grid: "#e1e0d9",
    },
    dark: {
        series: ["#3987e5", "#d95926", "#199e70", "#c98500"],
        text: "#c3c2b7",
        muted: "#898781",
        grid: "#2c2c2a",
    },
};
