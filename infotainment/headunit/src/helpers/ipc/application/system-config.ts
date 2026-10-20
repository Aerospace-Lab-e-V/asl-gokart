import { app } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import log from "electron-log/main";

interface SystemConfigData {
    autoStart: boolean;
    fullscreenOnStartup: boolean;
    devToolsEnabled: boolean;
    /** Hex sha256 of the admin PIN. Edit it in the config file; there is no UI to change it. */
    adminPinHash: string;
}

// TODO: set a kart-specific PIN hash in the config file. This default is sha256 of the old hard-coded "69420".
const DEFAULT_ADMIN_PIN_HASH = "441b7681786fefcf0b41c3952a0ffecb1221315407a031f61d145ae99dbe9bf7";

const DEFAULTS: SystemConfigData = {
    autoStart: false,
    fullscreenOnStartup: false,
    devToolsEnabled: true,
    adminPinHash: DEFAULT_ADMIN_PIN_HASH,
};

const CONFIG_FILE = path.join(app.getPath("userData"), "system-config.json");

function readConfig(): SystemConfigData {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return { ...DEFAULTS };
        }
        const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return {
            autoStart: parsed.autoStart ?? false,
            fullscreenOnStartup: parsed.fullscreenOnStartup ?? false,
            devToolsEnabled: parsed.devToolsEnabled ?? true,
            adminPinHash: parsed.adminPinHash ?? DEFAULT_ADMIN_PIN_HASH,
        };
    } catch (e) {
        log.error("[system-config] Failed to read system config:", e);
        return { ...DEFAULTS };
    }
}

function writeConfig(data: SystemConfigData): void {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        log.error("[system-config] Failed to write system config:", e);
    }
}

export function getAutoStart(): boolean {
    // Check desktop entry presence on Linux to be source of truth
    if (process.platform === "linux") {
        const autostartDir = path.join(os.homedir(), ".config", "autostart");
        const desktopFilePath = path.join(autostartDir, "headunit.desktop");
        return fs.existsSync(desktopFilePath);
    }
    return readConfig().autoStart;
}

export function setAutoStart(enabled: boolean): boolean {
    const config = readConfig();
    config.autoStart = enabled;
    writeConfig(config);

    if (process.platform === "linux") {
        const autostartDir = path.join(os.homedir(), ".config", "autostart");
        const desktopFilePath = path.join(autostartDir, "headunit.desktop");

        if (enabled) {
            try {
                if (!fs.existsSync(autostartDir)) {
                    fs.mkdirSync(autostartDir, { recursive: true });
                }
                const execPath = app.getPath("exe");
                const fileContent = `[Desktop Entry]
Type=Application
Name=Headunit
Exec=${execPath}
StartupNotify=false
Terminal=false
`;
                fs.writeFileSync(desktopFilePath, fileContent, "utf-8");
                log.info(`[system-config] Autostart desktop file created at ${desktopFilePath}`);
            } catch (e) {
                log.error("[system-config] Failed to create autostart desktop file:", e);
            }
        } else {
            try {
                if (fs.existsSync(desktopFilePath)) {
                    fs.unlinkSync(desktopFilePath);
                    log.info(`[system-config] Autostart desktop file removed at ${desktopFilePath}`);
                }
            } catch (e) {
                log.error("[system-config] Failed to remove autostart desktop file:", e);
            }
        }
    }
    return getAutoStart();
}

export function getFullscreenOnStartup(): boolean {
    return readConfig().fullscreenOnStartup;
}

export function setFullscreenOnStartup(enabled: boolean): boolean {
    const config = readConfig();
    config.fullscreenOnStartup = enabled;
    writeConfig(config);
    return getFullscreenOnStartup();
}

export function getDevToolsEnabled(): boolean {
    return readConfig().devToolsEnabled;
}

export function setDevToolsEnabled(enabled: boolean): boolean {
    const config = readConfig();
    config.devToolsEnabled = enabled;
    writeConfig(config);
    return getDevToolsEnabled();
}

export function getAdminPinHash(): string {
    return readConfig().adminPinHash;
}
