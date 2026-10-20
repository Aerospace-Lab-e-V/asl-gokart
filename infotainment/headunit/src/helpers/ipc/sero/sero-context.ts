import { SERO_BATTERY_MESSAGE_CHANNEL, SERO_LIGHTS_MESSAGE_CHANNEL, SERO_SEND_LIGHTS_CHANNEL, SERO_MOTOR_MESSAGE_CHANNEL, SERO_SEND_MOTOR_CHANNEL } from "./sero-channels";
import { LightsCommands, MotorCommands } from "@/data/zonecontrollers/zonecontrollers";

export function exposeSeroContext()  {
    const { contextBridge, ipcRenderer } = window.require('electron');
    
    contextBridge.exposeInMainWorld('sero', {
        // Send commands to the SERO zone controller for lights control
        sendLightsCommand: (command: LightsCommands, value?: any) => {
            ipcRenderer.send(SERO_SEND_LIGHTS_CHANNEL, { command, value });
        },
        // Listen for lights status updates from SERO
        onLightsMessage: (callback: (lightsMessage: string) => void) => {
            const listener = (_: unknown, message: string) => callback(message);
            ipcRenderer.on(SERO_LIGHTS_MESSAGE_CHANNEL, listener);
            return () => ipcRenderer.removeListener(SERO_LIGHTS_MESSAGE_CHANNEL, listener);
        },

        // Listen for battery status updates from SERO
        onBatteryMessage: (callback: (batteryMessage: string) => void) => {
            const listener = (_: unknown, message: string) => callback(message);
            ipcRenderer.on(SERO_BATTERY_MESSAGE_CHANNEL, listener);
            return () => ipcRenderer.removeListener(SERO_BATTERY_MESSAGE_CHANNEL, listener);
        },

        // Send commands to the SERO zone controller for motor control
        sendMotorCommand: (command: MotorCommands, value?: any) => {
            return ipcRenderer.invoke(SERO_SEND_MOTOR_CHANNEL, { command, value });
        },
        // Listen for motor status updates from SERO
        onMotorMessage: (callback: (motorMessage: string) => void) => {
            const listener = (_: unknown, message: string) => callback(message);
            ipcRenderer.on(SERO_MOTOR_MESSAGE_CHANNEL, listener);
            return () => ipcRenderer.removeListener(SERO_MOTOR_MESSAGE_CHANNEL, listener);
        },
    });
}