import { nativeTheme } from "electron";
import { ipcMain } from "electron";
import { CH } from "@/ipc/channels";
import type { ThemeMode } from "@/lib/types/theme-mode";
import { setTheme } from "@/helpers/ipc/application/system-config";

/** Sets the theme and remembers it for the next start (see main.ts). */
function apply(theme: ThemeMode): boolean {
    nativeTheme.themeSource = theme;
    setTheme(theme);
    return nativeTheme.shouldUseDarkColors;
}

export function addThemeEventListeners() {
    ipcMain.handle(CH.theme.current, () => nativeTheme.themeSource);
    ipcMain.handle(CH.theme.toggle, () => apply(nativeTheme.shouldUseDarkColors ? "light" : "dark"));
    ipcMain.handle(CH.theme.dark, () => apply("dark"));
    ipcMain.handle(CH.theme.light, () => apply("light"));
    ipcMain.handle(CH.theme.system, () => apply("system"));
}
