import { BrowserWindow, ipcMain } from "electron";
import { CH } from "@/ipc/channels";
import { getConfig, getStatus, putConfig } from "@/services/kart-agent/client";
import type { AgentState, ConfigPatch } from "@/services/kart-agent/schema";
import { requireAdmin } from "./admin";

/* Polls kart-agent's status from main and pushes it to the window, so the renderer never fetches it. */

const POLL_MS = 1000;

let state: AgentState = { status: null, error: null };
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/** One poll. The last status is kept while the agent is unreachable; `error` says why. */
export async function pollAgent(): Promise<AgentState> {
    try {
        state = { status: await getStatus(), error: null };
    } catch (e) {
        state = { ...state, error: e instanceof Error ? e.message : String(e) };
    }
    return state;
}

export function registerKartAgentListeners(mainWindow: BrowserWindow): void {
    ipcMain.handle(CH.agent.getState, () => state);
    ipcMain.handle(CH.agent.getConfig, () => getConfig());
    ipcMain.handle(CH.agent.putConfig, requireAdmin((_event, patch: ConfigPatch) => putConfig(patch)));

    running = true;
    // Next poll starts after the previous one finished, so a slow agent never stacks requests.
    const tick = async () => {
        const next = await pollAgent();
        if (!running) return;
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.agent.state, next);
        timer = setTimeout(tick, POLL_MS);
    };
    void tick();
}

export function stopKartAgent(): void {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
}
