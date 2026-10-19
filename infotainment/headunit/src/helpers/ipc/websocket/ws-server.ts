import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { BatteryContoller, ThrottleController, ZoneController, Zones } from '@/data/zonecontrollers/zonecontrollers';
import { WEBSOCKET_BATTERY_MESSAGE_CHANNEL, WEBSOCKET_THROTTLE_MESSAGE_CHANNEL, WEBSOCKET_BUTTONS_MESSAGE_CHANNEL, WEBSOCKET_LIGHTS_MESSAGE_CHANNEL } from './ws-channels';
import * as http from 'http';
import { ButtonHandler } from './handlers/button-handler';
import { defaultButtonMappings } from './handlers/default-mapping';
import { getBindAddress } from '@/helpers/ipc/hardware/network-config';
import { z } from 'zod';
import { WEBSOCKET_PORT } from '@/data/config';
const WebSocket = require('faye-websocket').WebSocket;

export let connected_zonecontrollers = new Map<Zones, ZoneController>();

const buttonHandler: ButtonHandler = new ButtonHandler(defaultButtonMappings);

let currentServer: http.Server | null = null;
let storedMainWindow: BrowserWindow | null = null;

const wsIncomingSchema = z.object({
  zone: z.string(),
  command: z.string().optional(),
  value: z.unknown().optional(),
  identifier: z.string().optional(),
});

export function startWebSocketServer(mainWindow: BrowserWindow) {
  storedMainWindow = mainWindow;
  const bindAddress = getBindAddress();
  const server = http.createServer();
  currentServer = server;

  server.on('upgrade', (req, socket, head) => {
    if (WebSocket.isWebSocket(req)) {
      const ws = new WebSocket(req, socket, head);

      log.info('WebSocket client connected');

      ws.on('message', (event: any) => {
        const message = event.data;
        let rawParsed: unknown;
        try {
          rawParsed = JSON.parse(message.toString());
        } catch {
          log.error('WebSocket: received non-JSON message, discarding');
          return;
        }
        const parseResult = wsIncomingSchema.safeParse(rawParsed);
        if (!parseResult.success) {
          log.error('WebSocket: received invalid message structure, discarding:', parseResult.error.message);
          return;
        }
        const receivedMsg = parseResult.data;

        if (receivedMsg.zone && !receivedMsg.command) {
          log.info(`Received register packet for zone [${receivedMsg.zone}]`);

          if (Object.values(Zones).includes(receivedMsg.zone as Zones)) {
            // if (!connected_zonecontrollers.has(receivedMsg.zone)) {
              switch (receivedMsg.zone) {
                case Zones.THROTTLE:
                  connected_zonecontrollers.set(receivedMsg.zone, new ThrottleController(ws));
                  break;
                case Zones.BATTERY:
                  connected_zonecontrollers.set(receivedMsg.zone, new BatteryContoller(ws));
                  break;
                case Zones.BUTTONS:
                  connected_zonecontrollers.set(receivedMsg.zone, new ZoneController(ws));
                  break;
                case Zones.LIGHTS:
                  connected_zonecontrollers.set(receivedMsg.zone, new ZoneController(ws));
                  break;
                default:
                  log.error("Couldn't register new zone controller: Invalid zone!");
              }

              log.info(`New zone controller connected: ${receivedMsg.zone}`);
              log.info(`Total zone controllers connected: ${connected_zonecontrollers.size}`);
              log.info(Array.from(connected_zonecontrollers.keys()));
            // } else {
            //   console.error(`This zone has already been registered!`);
            // }
          } else {
            log.error(`This zone does not exist!`);
          }
        } else {
          log.debug("Received data message from zone controller");

          // Find the zone controller that received the message
          connected_zonecontrollers.forEach((zc: ZoneController, zone: Zones) => {
            // console.log(`Checking zone controller ${zone}`);

            if (zc.webSocket === ws) {
              // console.log(`Found zone controller ${zone}`);
              switch (zone) {
                case Zones.THROTTLE:
                  log.debug("Forwarding message to ipcRenderer's ThrottleListener:");
                  log.debug(message.toString());
                  mainWindow.webContents.send(WEBSOCKET_THROTTLE_MESSAGE_CHANNEL, message.toString());
                  break;
                case Zones.BATTERY:
                  log.debug("Forwarding message to ipcRenderer's BatteryListener:");
                  log.debug(message.toString());
                  mainWindow.webContents.send(WEBSOCKET_BATTERY_MESSAGE_CHANNEL, message.toString());
                  break;
                case Zones.BUTTONS:
                  log.debug("Forwarding message to ipcRenderer's ButtonsListener:");
                  log.debug(message.toString());
                  // mainWindow.webContents.send(WEBSOCKET_BUTTONS_MESSAGE_CHANNEL, message.toString());

                  // Send the message to the ButtonHandler
                  buttonHandler.handleIncomingButtonMessage(JSON.parse(message.toString()));
                  break;
                case Zones.LIGHTS:
                  log.debug("Forwarding message to ipcRenderer's LightsListener:");
                  log.debug(message.toString());
                  mainWindow.webContents.send(WEBSOCKET_LIGHTS_MESSAGE_CHANNEL, message.toString());
                  break;
                default:
                  log.error("Couldn't send message to ipcRenderer: No zc registered for this message yet!");
              }
            }
          });
        }
      });

      ws.on('close', () => {
        log.info(`WebSocket client disconnected. Code: ${ws.code} | Reason: ${ws.reason}`);

        // Remove the zone controller from the map
        connected_zonecontrollers.forEach((zc, key) => {
          if (zc.webSocket === ws) {
            connected_zonecontrollers.delete(key);
            log.info(`Zone controller ${key} disconnected`);
            log.info(`Total zone controllers connected: ${connected_zonecontrollers.size}`);
            log.info(Array.from(connected_zonecontrollers.keys()));
          }
        });

        ws.close();
      });

      ws.on('error', (err: any) => {
        log.error(`WebSocket client error: ${err.name} | ${err.message} | ${err.stack}`);
      });
    }
  });

  server.listen(WEBSOCKET_PORT, bindAddress, () => {
    log.info(`WebSocket server is running on ws://${bindAddress}:${WEBSOCKET_PORT}`);
  });

  server.on('error', (err) => {
    log.error(`WebSocket server error name: ${err.name}`);
    log.error(`WebSocket server error: ${err.message}`);
    log.error(`WebSocket server error stack: ${err.stack}`);
    log.error(`WebSocket server error cause: ${err.cause}`);
  });
}

export function stopWebSocketServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Close all connected zone controller WebSockets
    connected_zonecontrollers.forEach((zc) => {
      if (zc.webSocket) {
        zc.webSocket.close(1012, 'Server restarting');
      }
    });
    connected_zonecontrollers.clear();

    if (currentServer) {
      currentServer.close((err) => {
        if (err) {
          log.error(`Error stopping WebSocket server: ${err.message}`);
          reject(err);
        } else {
          log.info('WebSocket server stopped');
          currentServer = null;
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

export async function restartWebSocketServer(): Promise<void> {
  if (!storedMainWindow) {
    throw new Error('WebSocket server has not been started yet');
  }
  await stopWebSocketServer();
  startWebSocketServer(storedMainWindow);
}
