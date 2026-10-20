import { EcuId, EcuPresence, EcuStatusMap } from '@/data/ecu/ecu-types';
import { ECU_DEFINITIONS } from '@/data/ecu/ecu-definitions';

/*
 * Which zone controllers are reachable, from Sero service discovery. Sero reports "found" only on
 * a transition to found, and "lost" when the 30 s offer TTL runs out or right before "found" when a
 * controller rebooted, so the map changes only when the status really does.
 */

type PresenceListener = (ecuId: EcuId, presence: EcuPresence) => void;

const offline = (): EcuStatusMap =>
    Object.fromEntries(ECU_DEFINITIONS.map((d) => [d.id, { online: false, changedAt: Date.now() }])) as EcuStatusMap;

let status: EcuStatusMap = offline();
const listeners = new Set<PresenceListener>();

const ecuIdFor = (serviceId: number): EcuId | undefined =>
    ECU_DEFINITIONS.find((d) => d.seroServiceId === serviceId)?.id;

function set(serviceId: number, presence: Omit<EcuPresence, 'changedAt'>): void {
    const ecuId = ecuIdFor(serviceId);
    if (!ecuId) return;
    const next = { ...presence, changedAt: Date.now() };
    status = { ...status, [ecuId]: next };
    listeners.forEach((l) => l(ecuId, next));
}

export const markServiceFound = (serviceId: number, ip: string): void => set(serviceId, { online: true, ip });

export const markServiceLost = (serviceId: number): void => set(serviceId, { online: false });

export const getEcuStatus = (): EcuStatusMap => status;

/** Every controller goes offline, e.g. when the Sero runtime is restarted on another interface. */
export function resetEcuPresence(): void {
    status = offline();
    for (const [ecuId, presence] of Object.entries(status)) listeners.forEach((l) => l(ecuId as EcuId, presence));
}

/** Returns a function that removes the listener. */
export function onEcuPresenceChange(listener: PresenceListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
