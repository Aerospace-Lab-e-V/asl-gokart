import { app } from "electron";
import fs from "fs";
import path from "path";
import log from "electron-log/main";

export function getTinybufConfigPath(): string {
    if (process.env.TINYBUF_CONFIG_PATH && fs.existsSync(process.env.TINYBUF_CONFIG_PATH)) {
        return process.env.TINYBUF_CONFIG_PATH;
    }
    const userDataPath = app.getPath("userData");
    const configPath = path.join(userDataPath, "tinybuf-config.json");
    if (!fs.existsSync(configPath)) {
        const defaultConfig = {
            LoggingManager: {
                pattern: "%Y-%m-%d %H:%M:%S [%p] %s: %t",
                defaultLogLevel: "information",
                logLevel: "information",
            },
            Proxy: {
                logLevel: "information",
                sendMessages: ["LedCommand"],
                receiveMessages: ["AdcStatus"],
                port: 5004,
                capacityMessageBuffer: 512,
                sendGroup: "239.168.178.2",
                receiveGroups: ["239.168.178.1"],
            },
        };
        try {
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
            log.info(`[TINYBUF] Created default config file at: ${configPath}`);
        } catch (err) {
            log.error("[TINYBUF] Failed to write default config file:", err);
        }
    }
    return configPath;
}
