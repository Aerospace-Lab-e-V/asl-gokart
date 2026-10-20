import { useEffect, useState } from "react";

const isDark = () => document.documentElement.classList.contains("dark");

/** Follows the `dark` class on <html>, which the theme helpers toggle. */
export function useIsDark(): boolean {
    const [dark, setDark] = useState(isDark);
    useEffect(() => {
        const observer = new MutationObserver(() => setDark(isDark()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);
    return dark;
}
