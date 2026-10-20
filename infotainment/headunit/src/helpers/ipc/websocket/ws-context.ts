import { WEBSOCKET_BUTTONS_MESSAGE_CHANNEL, WEBSOCKET_MESSAGE_CHANNEL, WEBSOCKET_SEND_CHANNEL, WEBSOCKET_THROTTLE_MESSAGE_CHANNEL } from './ws-channels';
import { OutgoingPacket } from '@/data/zonecontrollers/packets';
import { Zones } from '@/data/zonecontrollers/zonecontrollers';

export function exposeWebSocketContext() {
    const { contextBridge, ipcRenderer } = window.require('electron');

    contextBridge.exposeInMainWorld('websocket', {
        send: (message: OutgoingPacket, zone: Zones) => {
            ipcRenderer.send(WEBSOCKET_SEND_CHANNEL, message, zone); 

        },
        onThrottleMessage: (callback: (throttleMessage: string) => void) => {
            const listener = (_: unknown, message: string) => callback(message);
            ipcRenderer.on(WEBSOCKET_THROTTLE_MESSAGE_CHANNEL, listener);
            return () => ipcRenderer.removeListener(WEBSOCKET_THROTTLE_MESSAGE_CHANNEL, listener);
        },
    });
}