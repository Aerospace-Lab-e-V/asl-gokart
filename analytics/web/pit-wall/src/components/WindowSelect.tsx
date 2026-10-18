import { Link } from "@tanstack/react-router";
import { WINDOWS_MIN, type WindowMin } from "../views/presets";

/** Chart time window, kept in the URL (`?window=5`) so a view can be shared. */
export function WindowSelect({ value }: { value: WindowMin }) {
    return (
        <div className="join" role="group" aria-label="Chart window">
            {WINDOWS_MIN.map((w) => (
                <Link
                    key={w}
                    to="."
                    search={(prev: Record<string, unknown>) => ({ ...prev, window: w })}
                    className={`btn btn-sm join-item ${w === value ? "btn-active" : ""}`}
                    aria-pressed={w === value}
                >
                    {w} min
                </Link>
            ))}
        </div>
    );
}
