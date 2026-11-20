import { ANIMATIONS, colorSignal, findAnimation, rgbToNumber, type AnimationLayer, type Rgb } from "@/domain/lights";
import type { SignalName } from "@/domain/signals";

/*
 * zc_lights welcome settings blob, version 1. Mirrors zc/zc_lights/src/core/lights_config.hpp; keep in sync.
 *
 *   u8 version | u8 flags (b0 enabled) | u8 front_id | u8 rear_id | u8 ambient
 *   | u8 nc, nc × [u8 layer (0 front, 1 rear), u8 id, u8 r, u8 g, u8 b]
 *   | u8 nf, nf × front id | u8 nr, nr × rear id      (catalog: the ids the firmware has)
 *
 * Trailing bytes are ignored so the firmware can append fields.
 */

export const LIGHTS_CONFIG_VERSION = 1;

export interface LightsConfig {
    enabled: boolean;
    front: number;
    rear: number;
    ambient: number;
    colors: { layer: AnimationLayer; id: number; rgb: Rgb }[];
    /** Ids the firmware has; undefined when the blob carries no catalog. */
    frontIds?: number[];
    rearIds?: number[];
}

const LAYERS: AnimationLayer[] = ["front", "rear"];

/** Null for another version or a truncated blob. */
export function decodeLightsConfig(p: Uint8Array): LightsConfig | null {
    if (p.length < 6 || p[0] !== LIGHTS_CONFIG_VERSION) return null;
    const nc = p[5];
    let o = 6 + 5 * nc;
    if (p.length < o) return null;

    const colors: LightsConfig["colors"] = [];
    for (let k = 0; k < nc; k++) {
        const e = 6 + 5 * k;
        const layer = LAYERS[p[e]];
        if (layer) colors.push({ layer, id: p[e + 1], rgb: [p[e + 2], p[e + 3], p[e + 4]] });
    }
    const config: LightsConfig = { enabled: (p[1] & 1) === 1, front: p[2], rear: p[3], ambient: p[4], colors };

    const readIds = (): number[] | undefined => {
        if (o >= p.length) return undefined;
        const n = p[o];
        if (p.length < o + 1 + n) return undefined;
        const ids = [...p.subarray(o + 1, o + 1 + n)];
        o += 1 + n;
        return ids;
    };
    config.frontIds = readIds();
    config.rearIds = config.frontIds && readIds();
    return config;
}

/** The blob as the firmware sends it (used by the mock runtime and tests). */
export function encodeLightsConfig(c: LightsConfig): Buffer<ArrayBuffer> {
    const bytes = [LIGHTS_CONFIG_VERSION, c.enabled ? 1 : 0, c.front, c.rear, c.ambient, c.colors.length];
    for (const { layer, id, rgb } of c.colors) bytes.push(layer === "front" ? 0 : 1, id, ...rgb);
    if (c.frontIds && c.rearIds) bytes.push(c.frontIds.length, ...c.frontIds, c.rearIds.length, ...c.rearIds);
    return Buffer.from(bytes);
}

/** Bitmask with bit n set for id n. */
export const idMask = (ids: number[]): number => ids.reduce((m, id) => m | (1 << id), 0);

/** The signals a config blob sets, as `[name, value]`. Colours of animations the headunit does not know are skipped. */
export function configSignals(c: LightsConfig): [SignalName, number][] {
    const out: [SignalName, number][] = [
        ["lights.welcome_enabled", c.enabled ? 1 : 0],
        ["lights.welcome_front", c.front],
        ["lights.welcome_rear", c.rear],
        ["lights.ambient", c.ambient],
    ];
    if (c.frontIds) out.push(["lights.front_anims", idMask(c.frontIds)]);
    if (c.rearIds) out.push(["lights.rear_anims", idMask(c.rearIds)]);
    for (const { layer, id, rgb } of c.colors) {
        const a = findAnimation(layer, id);
        if (a?.customColor) out.push([colorSignal(a), rgbToNumber(rgb)]);
    }
    return out;
}

/** The firmware's defaults (LightsConfig{} in lights_config.hpp) with its full catalog. */
export function defaultLightsConfig(): LightsConfig {
    const colors: LightsConfig["colors"] = [];
    for (const layer of LAYERS) {
        for (const a of ANIMATIONS[layer]) if (a.customColor) colors.push({ layer, id: a.id, rgb: [...a.defaultColor] });
    }
    return {
        enabled: true,
        front: 0,
        rear: 0,
        ambient: 255,
        colors,
        frontIds: ANIMATIONS.front.map((a) => a.id),
        rearIds: ANIMATIONS.rear.map((a) => a.id),
    };
}
