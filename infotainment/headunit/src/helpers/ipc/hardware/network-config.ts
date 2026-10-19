import { app } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import log from "electron-log/main";

interface NetworkConfigData {
    selectedMac: string | null;
}

const CONFIG_FILE = path.join(app.getPath("userData"), "network-config.json");

function readConfig(): NetworkConfigData {
    try {
        const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return {
            selectedMac: parsed.selectedMac ?? null,
        };
    } catch {
        return { selectedMac: null };
    }
}

function writeConfig(data: NetworkConfigData): void {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export interface ResolvedInterface {
    name: string;
    mac: string;
    address: string;
    family: string;
    netmask: string;
    internal: boolean;
}

/**
 * Resolve a MAC address to its current IPv4 interface info.
 * Returns null if the MAC is not found among current OS interfaces.
 */
export function resolveInterfaceByMac(mac: string): ResolvedInterface | null {
    const interfaces = os.networkInterfaces();
    for (const [name, infos] of Object.entries(interfaces)) {
        if (!infos) continue;
        for (const info of infos) {
            if (info.mac === mac && info.family === "IPv4" && !info.internal) {
                return {
                    name,
                    mac: info.mac,
                    address: info.address,
                    family: info.family,
                    netmask: info.netmask,
                    internal: info.internal,
                };
            }
        }
    }
    return null;
}

export function getStoredMac(): string | null {
    return readConfig().selectedMac;
}

export function setStoredMac(mac: string | null): void {
    const config = readConfig();
    config.selectedMac = mac;
    writeConfig(config);
}

/**
 * Returns the bind IP address for the currently selected interface.
 * Falls back to "0.0.0.0" if no interface is selected or the MAC
 * can't be resolved to a current interface.
 */
export function getBindAddress(): string {
    const mac = getStoredMac();
    if (!mac) return "0.0.0.0";
    const resolved = resolveInterfaceByMac(mac);
    if (!resolved) {
        log.warn(`[network-config] Stored MAC ${mac} not found, falling back to 0.0.0.0`);
        return "0.0.0.0";
    }
    return resolved.address;
}

/**
 * Returns info about the currently selected interface, or null if none selected
 * or the stored MAC cannot be resolved.
 */
export function getCurrentInterface(): ResolvedInterface | null {
    const mac = getStoredMac();
    if (!mac) return null;
    return resolveInterfaceByMac(mac);
}
