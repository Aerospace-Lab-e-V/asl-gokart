import {
    TINYBUF_ADC_STATUS_CHANNEL,
    TINYBUF_SEND_LED_CHANNEL,
    TINYBUF_GET_STATUS_CHANNEL,
} from "./tinybuf-channels";
import { AdcStatusData, TinybufStatus } from "@/data/tinybuf/tinybuf-types";

export function exposeTinybufContext() {
    const { contextBridge, ipcRenderer } = window.require("electron");

    contextBridge.exposeInMainWorld("tinybuf", {
        // Send command to toggle LED
        sendLedCommand: (on: boolean, sequence?: number): Promise<boolean> => {
            return ipcRenderer.invoke(TINYBUF_SEND_LED_CHANNEL, { on, sequence });
        },
        // Listen for ADC status updates
        onAdcStatus: (callback: (data: AdcStatusData) => void) => {
            const listener = (_: unknown, data: AdcStatusData) => callback(data);
            ipcRenderer.on(TINYBUF_ADC_STATUS_CHANNEL, listener);
            return () => ipcRenderer.removeListener(TINYBUF_ADC_STATUS_CHANNEL, listener);
        },
        // Get tinybuf service status
        getStatus: (): Promise<TinybufStatus> => {
            return ipcRenderer.invoke(TINYBUF_GET_STATUS_CHANNEL);
        },
    });
}
