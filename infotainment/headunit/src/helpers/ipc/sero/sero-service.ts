// Import the sero-node module
import {
    SeroRuntime,
} from '@asl-gokart/sero-node';
import { BrowserWindow, ipcMain, ipcRenderer } from 'electron';
import log from 'electron-log/main';
import { SERO_SEND_LIGHTS_CHANNEL, SERO_LIGHTS_MESSAGE_CHANNEL, SERO_BATTERY_MESSAGE_CHANNEL, SERO_MOTOR_MESSAGE_CHANNEL, SERO_SEND_MOTOR_CHANNEL } from './sero-channels';
import { BatteryCommands, LightsCommands, MotorCommands, Zones } from '@/data/zonecontrollers/zonecontrollers';
import { IncomingPacket } from '@/data/zonecontrollers/packets';
import { getBindAddress } from '@/helpers/ipc/hardware/network-config';
import { SERO_UNICAST_PORT, SERO_CLIENT_ID, ZC_OTA_METHOD_ID } from '@/data/config';

const RT_INTERVAL = 10; // Interval in milliseconds for processing SeroRuntime events

let rt: SeroRuntime | null = null;
let rtInterval: ReturnType<typeof setInterval> | null = null;
let storedMainWindow: BrowserWindow | null = null;

function createRuntime(): SeroRuntime {
    const bindIp = getBindAddress();
    const runtime = new SeroRuntime({
        port: SERO_UNICAST_PORT,
        clientId: SERO_CLIENT_ID,
        bindIp,
    });
    return runtime;
}

export function startSeroService(mainWindow: BrowserWindow) {
    storedMainWindow = mainWindow;
    rt = createRuntime();
    const runtime = rt;
    rtInterval = setInterval(() => runtime.process(), RT_INTERVAL);

    log.info("Starting SERO service...");
    log.info('SeroRuntime initialized on', runtime.getLocalAddress().ip, 'port', runtime.getLocalAddress().port);
    
    // Services whose events this runtime subscribed to. Sero renews the subscriptions by itself
    // when a service is found again (e.g. after an OTA restart), so each is subscribed only once;
    // a second subscribeEvent would only swap the handler and leak the old JS callback.
    const subscribedServices = new Set<number>();

    runtime.onServiceFound((serviceId, address) => {
        log.info('Service found:', serviceId, 'at', address);
        if (subscribedServices.has(serviceId)) return;
        subscribedServices.add(serviceId);
        if(serviceId == 0x0001) {
            // Subscribe to LED state change events (event ID 0x8001: [left, right])
            runtime.subscribeEvent(0x0001, 0x8001, (svcId, evtId, payload) => {
                log.debug(`[SERO] LED state event: left=${payload[0]}, right=${payload[1]}`);
                handleTurnsignalEvent(mainWindow, payload);
            });
            // Subscribe to DRL state change events (event ID 0x8006: [on])
            runtime.subscribeEvent(0x0001, 0x8006, (svcId, evtId, payload) => {
                log.debug(`[SERO] DRL state event: on=${payload[0]}`);
                // Pass [on, on] so existing UI expecting [left, right] still works
                handleHeadlightsEvent(mainWindow, Buffer.from([payload[0], payload[0]]));
            });
            // Subscribe to Tail state change events (event ID 0x8007: [on])
            runtime.subscribeEvent(0x0001, 0x8007, (svcId, evtId, payload) => {
                log.debug(`[SERO] Tail state event: on=${payload[0]}`);
                handleTailEvent(mainWindow, payload);
            });
            // Subscribe to high beam state change events (event ID 0x8003: [left, right])
            runtime.subscribeEvent(0x0001, 0x8003, (svcId, evtId, payload) => {
                log.debug(`[SERO] High beam state event: left=${payload[0]}, right=${payload[1]}`);
                handleHighBeamsEvent(mainWindow, payload);
            });
        }
        if(serviceId == 0x0003) {
            // Subscribe to battery voltage events (event ID 0x8001: float voltage)
            runtime.subscribeEvent(0x0003, 0x8001, (svcId, evtId, payload) => {
                log.debug(`[SERO] Battery voltage event: voltage=${payload.readFloatLE(0)}`);
                handleZcBatteryVoltageEvent(mainWindow, payload);
            });
            runtime.subscribeEvent(0x0003, 0x8002, (svcId, evtId, payload) => {
                log.debug(`[SERO] Battery current event: current=${payload.readFloatLE(0)}`);
                handleZcBatteryCurrentEvent(mainWindow, payload);
            });
            runtime.subscribeEvent(0x0003, 0x8003, (svcId, evtId, payload) => {
                const floatCount = Math.floor(payload.length / 4);
                const tempValues = Array.from({ length: floatCount }, (_, i) => payload.readFloatLE(i * 4));
                log.debug(`[SERO] Battery temperature event: temperatures=[${tempValues.join(', ')}]`);
                handleZcBatteryTemperatureEvent(mainWindow, tempValues);
            });
        }
        if(serviceId == 0x0004) {
            // Subscribe to motor RPM events (event ID 0x8001: 16 bytes)
            runtime.subscribeEvent(0x0004, 0x8001, (svcId, evtId, payload) => {
                log.debug(`[SERO] Motor event: payload size=${payload.length}`);
                handleZcMotorEvent(mainWindow, payload);
            });
        }
    });
    
    runtime.onServiceLost((service) => {
        log.info('Service lost:', service);
    });
    
    runtime.onSubscriptionAck((ack) => {
        log.debug('Subscription acknowledged:', ack);
    });

    runtime.findService(0x0001);
    runtime.findService(0x0002); // zc_buttons
    runtime.findService(0x0003);
    runtime.findService(0x0004); // zc_motor
}

// --- zc_lights ---------------------------------------------------------------------------

function handleLightsCommand(command: LightsCommands, value?: any) {
    if (!rt) {
        log.error('[SERO] Cannot toggle lights: SeroRuntime not initialized');
        return;
    }
    switch (command) {
        case LightsCommands.SET_TOGGLE_TURN_SIGNAL_LEFT:
            rt.fireAndForget(0x0001, 0x0002);
            break;
        case LightsCommands.SET_TOGGLE_TURN_SIGNAL_RIGHT:
            rt.fireAndForget(0x0001, 0x0003);
            break;
        case LightsCommands.SET_TOGGLE_HAZARD_LIGHTS:
            rt.fireAndForget(0x0001, 0x0004);
            break;
        case LightsCommands.SET_TOGGLE_HEADLIGHTS:
            rt.fireAndForget(0x0001, 0x0009);
            break;
        case LightsCommands.SET_TOGGLE_HIGH_BEAMS:
            rt.fireAndForget(0x0001, 0x0006);
            break;
        case LightsCommands.SET_TOGGLE_BRAKE:
            rt.fireAndForget(0x0001, 0x0007);
            break;
        case LightsCommands.SET_TOGGLE_REVERSE:
            rt.fireAndForget(0x0001, 0x0008);
            break;
        case LightsCommands.SET_TOGGLE_DRL:
            rt.fireAndForget(0x0001, 0x0009);
            break;
        case LightsCommands.SET_TOGGLE_TAIL_LIGHT:
            rt.fireAndForget(0x0001, 0x000D);
            break;
        case LightsCommands.TRIGGER_WELCOME_LIGHT:
            rt.fireAndForget(0x0001, 0x000A);
            break;
        case LightsCommands.SET_BRIGHTNESS:
            if (Array.isArray(value) && value.length === 2) {
                rt.fireAndForget(0x0001, 0x000B, Buffer.from(value));
            } else {
                log.error('[SERO] Invalid payload for SET_BRIGHTNESS:', value);
            }
            break;
        case LightsCommands.SET_WELCOME_LIGHT_COLOR:
            if (Array.isArray(value) && value.length === 3) {
                rt.fireAndForget(0x0001, 0x000C, Buffer.from(value));
            } else {
                log.error('[SERO] Invalid payload for SET_WELCOME_LIGHT_COLOR:', value);
            }
            break;
    }
}

function handleTurnsignalEvent(mainWindow: BrowserWindow, payload: Buffer<ArrayBufferLike>) {
    const left = payload[0];
    const right = payload[1];
    const incomingPacket: IncomingPacket = {
        zone: Zones.LIGHTS,
        command: LightsCommands.GET_TURN_SIGNAL_LIGHTS,
        value: [left, right],
    };

    mainWindow.webContents.send(SERO_LIGHTS_MESSAGE_CHANNEL, JSON.stringify(incomingPacket));
}

function handleHeadlightsEvent(mainWindow: BrowserWindow, payload: Buffer<ArrayBufferLike>) {
    const left = payload[0];
    const right = payload[1];
    const incomingPacket: IncomingPacket = {
        zone: Zones.LIGHTS,
        command: LightsCommands.GET_HEADLIGHTS,
        value: [left, right],
    };

    mainWindow.webContents.send(SERO_LIGHTS_MESSAGE_CHANNEL, JSON.stringify(incomingPacket));
}

function handleHighBeamsEvent(mainWindow: BrowserWindow, payload: Buffer<ArrayBufferLike>) {
    const left = payload[0];
    const right = payload[1];
    const incomingPacket: IncomingPacket = {
        zone: Zones.LIGHTS,
        command: LightsCommands.GET_HIGH_BEAMS,
        value: [left, right],
    };

    mainWindow.webContents.send(SERO_LIGHTS_MESSAGE_CHANNEL, JSON.stringify(incomingPacket));
}

function handleTailEvent(mainWindow: BrowserWindow, payload: Buffer<ArrayBufferLike>) {
    const incomingPacket: IncomingPacket = {
        zone: Zones.LIGHTS,
        command: LightsCommands.GET_TAIL_LIGHTS,
        value: [payload[0]],
    };

    mainWindow.webContents.send(SERO_LIGHTS_MESSAGE_CHANNEL, JSON.stringify(incomingPacket));
}

// --- zc_battery ---------------------------------------------------------------------------

function handleZcBatteryVoltageEvent(mainWindow: BrowserWindow, payload: any) {
    const voltage = payload.readFloatLE(0);
    const incomingPacket: IncomingPacket = {
        zone: Zones.BATTERY,
        command: BatteryCommands.GET_VOLTAGE, // Event ID for voltage change
        value: voltage,
    };

    mainWindow.webContents.send(SERO_BATTERY_MESSAGE_CHANNEL, JSON.stringify(incomingPacket));
}

function handleZcBatteryCurrentEvent(mainWindow: BrowserWindow, payload: any) {
    const current = payload.readFloatLE(0);
    const incomingPacket: IncomingPacket = {
        zone: Zones.BATTERY,
        command: BatteryCommands.GET_CURRENT, // Event ID for current change
        value: current,
    };

    mainWindow.webContents.send(SERO_BATTERY_MESSAGE_CHANNEL, JSON.stringify(incomingPacket));
}

function handleZcBatteryTemperatureEvent(mainWindow: BrowserWindow, temps: number[]) {
    const incomingPacket: IncomingPacket = {
        zone: Zones.BATTERY,
        command: BatteryCommands.GET_TEMP,
        value: temps,
    };

    mainWindow.webContents.send(SERO_BATTERY_MESSAGE_CHANNEL, JSON.stringify(incomingPacket));
}

// -----------------------------------------------------------------------------------------

// --- zc_motor ---------------------------------------------------------------------------

function handleZcMotorEvent(mainWindow: BrowserWindow, payload: any) {
    if (payload.length < 16) {
        log.error(`[SERO] Invalid payload size for motor event: ${payload.length}`);
        return;
    }
    const parseKellyData = (offset: number) => ({
        rpm: payload.readUInt16BE(offset),
        throttle: payload[offset + 2],
        brakePedal: payload[offset + 3],
        switches: payload[offset + 4],
        batteryVoltage: payload[offset + 5],
        motorTemp: payload[offset + 6],
        controllerTemp: payload[offset + 7],
    });

    const leftData = parseKellyData(0);
    const rightData = parseKellyData(8);

    // Take the average RPM for general logic
    const rpm = Math.round((leftData.rpm + rightData.rpm) / 2);
    
    // RPM
    const rpmPacket: IncomingPacket = {
        zone: Zones.MOTOR,
        command: MotorCommands.GET_RPM,
        value: rpm,
    };
    mainWindow.webContents.send(SERO_MOTOR_MESSAGE_CHANNEL, JSON.stringify(rpmPacket));

    // Left Motor Data
    const leftPacket: IncomingPacket = {
        zone: Zones.MOTOR,
        command: MotorCommands.GET_LEFT_MOTOR_DATA,
        value: leftData,
    };
    mainWindow.webContents.send(SERO_MOTOR_MESSAGE_CHANNEL, JSON.stringify(leftPacket));

    // Right Motor Data
    const rightPacket: IncomingPacket = {
        zone: Zones.MOTOR,
        command: MotorCommands.GET_RIGHT_MOTOR_DATA,
        value: rightData,
    };
    mainWindow.webContents.send(SERO_MOTOR_MESSAGE_CHANNEL, JSON.stringify(rightPacket));

    // ponytail: Parse relay states from telemetry if present
    if (payload.length >= 18) {
        const relay1 = payload[16] === 1;
        const relay2 = payload[17] === 1;
        const relaysPacket: IncomingPacket = {
            zone: Zones.MOTOR,
            command: MotorCommands.GET_RELAY_STATES,
            value: [relay1, relay2],
        };
        mainWindow.webContents.send(SERO_MOTOR_MESSAGE_CHANNEL, JSON.stringify(relaysPacket));
    }

    // ponytail: Parse reverse active state from telemetry if present
    if (payload.length >= 19) {
        const reverseActive = payload[18] === 1;
        const reversePacket: IncomingPacket = {
            zone: Zones.MOTOR,
            command: MotorCommands.GET_REVERSE,
            value: reverseActive ? 1 : 0,
        };
        mainWindow.webContents.send(SERO_MOTOR_MESSAGE_CHANNEL, JSON.stringify(reversePacket));
    }
}

// -----------------------------------------------------------------------------------------

// ── OTA ──────────────────────────────────────────────────────────────────────

/**
 * Send a firmware OTA trigger to a specific zone controller.
 * Sends the download URL as a Sero REQUEST to the ZC's own service using
 * the reserved OTA method ID (0x00FF). The ZC responds E_OK immediately,
 * then begins the update in a FreeRTOS background task and reboots.
 *
 * @param serviceId  The Sero service ID of the target ZC (from EcuDefinition.seroServiceId)
 * @param url        The HTTP URL of the firmware binary served by the in-vehicle file server
 */
export async function sendOtaTrigger(serviceId: number, url: string): Promise<void> {
    if (!rt) {
        throw new Error('[SERO] Cannot send OTA trigger: SeroRuntime not initialized');
    }
    const payload = Buffer.from(url, 'utf-8');
    log.info(`[SERO] Sending OTA trigger to service 0x${serviceId.toString(16).padStart(4, '0')}: ${url}`);
    const result = await rt.request(serviceId, ZC_OTA_METHOD_ID, payload);
    if (result.returnCode !== 0 /* E_OK */) {
        throw new Error(`[SERO] OTA trigger rejected by ECU (returnCode=${result.returnCode})`);
    }
    log.info(`[SERO] OTA trigger acknowledged by service 0x${serviceId.toString(16).padStart(4, '0')}`);
}

// ─────────────────────────────────────────────────────────────────────────────

export function stopSeroService(): void {
    if (rtInterval) {
        clearInterval(rtInterval);
        rtInterval = null;
    }
    if (rt) {
        rt.destroy();
        rt = null;
        log.info('[SERO] SeroRuntime destroyed');
    }
}

export function restartSeroService(): void {
    if (!storedMainWindow) {
        throw new Error('Sero service has not been started yet');
    }
    stopSeroService();
    startSeroService(storedMainWindow);
}

async function handleMotorCommand(command: MotorCommands, value?: any): Promise<boolean> {
    if (!rt) {
        log.error('[SERO] Cannot send motor command: SeroRuntime not initialized');
        return false;
    }
    switch (command) {
        case MotorCommands.TOGGLE_RELAY: {
            if (typeof value !== 'number') {
                log.error('[SERO] Invalid payload for TOGGLE_RELAY: value must be a number');
                return false;
            }
            const serviceId = 0x0004; // zc_motor
            const methodId = 0x0005;  // ZC_MOTOR_TOGGLE_RELAY_METHOD_ID
            const payload = Buffer.from([value]);
            try {
                log.info(`[SERO] Sending TOGGLE_RELAY request to zc_motor for relay ${value}`);
                const result = await rt.request(serviceId, methodId, payload);
                if (result.returnCode === 0 /* E_OK */) {
                    log.info(`[SERO] Relay ${value} toggle request succeeded`);
                    return true;
                } else {
                    log.error(`[SERO] Relay ${value} toggle request failed with returnCode=${result.returnCode}`);
                    return false;
                }
            } catch (err) {
                log.error(`[SERO] Relay ${value} toggle request errored:`, err);
                return false;
            }
        }
        default:
            log.error('[SERO] Unknown motor command:', command);
            return false;
    }
}

// Handles IPC messages from the renderer
export function registerSeroHandlers() {
    // Listen for commands to control turn signals
    ipcMain.on(SERO_SEND_LIGHTS_CHANNEL, (_, args) => {
        log.debug(`[SERO_SEND_LIGHTS_CHANNEL] Received command: ${JSON.stringify(args)}`);
        const { command, value } = args;
        handleLightsCommand(command, value);
    });

    // Listen for commands to control motors
    ipcMain.handle(SERO_SEND_MOTOR_CHANNEL, async (_, args) => {
        log.debug(`[SERO_SEND_MOTOR_CHANNEL] Received command: ${JSON.stringify(args)}`);
        const { command, value } = args;
        return handleMotorCommand(command, value);
    });
}
