import { nativeTheme } from "electron";
import { ipcMain } from "electron";
import { CH } from "@/ipc/channels";

export function addThemeEventListeners() {
    ipcMain.handle(CH.theme.current, () => nativeTheme.themeSource);
    ipcMain.handle(CH.theme.toggle, () => {
        if (nativeTheme.shouldUseDarkColors) {
            nativeTheme.themeSource = "light";
        } else {
            nativeTheme.themeSource = "dark";
        }
        return nativeTheme.shouldUseDarkColors;
    });
    ipcMain.handle(CH.theme.dark, () => (nativeTheme.themeSource = "dark"));
    ipcMain.handle(CH.theme.light, () => (nativeTheme.themeSource = "light"));
    ipcMain.handle(CH.theme.system, () => {
        nativeTheme.themeSource = "system";
        return nativeTheme.shouldUseDarkColors;
    });
}
