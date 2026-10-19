import { setTheme, useTheme } from "../views/theme";
import { Moon, Sun } from "lucide-react";

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
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
    );
}
