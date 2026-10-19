import { setTheme, useTheme } from "../views/theme";
import { MoonIcon, SunIcon } from "./icons";

export function ThemeToggle() {
    const theme = useTheme();
    const next = theme === "dark" ? "light" : "dark";
    return (
        <button
            type="button"
            className="btn btn-ghost btn-square"
            onClick={() => setTheme(next)}
            aria-label={`Switch to ${next} theme`}
            title={`Switch to ${next} theme`}
        >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
    );
}
