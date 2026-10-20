import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import registerListeners from "./helpers/ipc/listeners-register";
import path from "path";
import { stopSeroAdapter } from "./main/adapters/sero";
import { stopKartAgent } from "./main/kart-agent";
import { getFullscreenOnStartup, getDevToolsEnabled } from "./helpers/ipc/application/system-config";

// Initialize electron-log before anything else
log.initialize();
log.transports.console.level = "info";
log.transports.file.level = "info";

const inDevelopment = process.env.NODE_ENV === "development";

if (require("electron-squirrel-startup")) {
    app.quit();
}

function createWindow() {
    const preload = path.join(__dirname, "preload.js");
    const isFullscreen = getFullscreenOnStartup();
    // Read once: DevTools can only be opened in a window created with them enabled.
    const devToolsEnabled = getDevToolsEnabled();
    const mainWindow = new BrowserWindow({
        width: 1024,
        height: 600,
        fullscreen: isFullscreen,
        webPreferences: {
            devTools: devToolsEnabled,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            sandbox: true,
            webSecurity: true,
            preload: preload,
        },
        titleBarStyle: "default",
        autoHideMenuBar: true,
    });
    registerListeners(mainWindow);

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(
            path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
        );
    }
    if (devToolsEnabled) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on("before-quit", () => {
    stopSeroAdapter();
    stopKartAgent();
});

//osX only
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
//osX only ends
