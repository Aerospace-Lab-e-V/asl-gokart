// Port of zc/zc_lights/src/core/canvas.hpp — keep in sync.
import { clamp01 } from "./easing";

/*
 * Intensity canvases the animations draw into: one byte per pixel, perceptual 0..255.
 * Gamma, ambient brightness and colour are applied by the compositor.
 */

const toU8 = (i: number) => Math.floor(clamp01(i) * 255 + 0.5);

export class Canvas1D {
    readonly px: Uint8Array;
    constructor(readonly len: number) {
        this.px = new Uint8Array(len);
    }
    fill(i: number): void {
        this.px.fill(toU8(i));
    }
    set(n: number, i: number): void {
        if (n >= 0 && n < this.len) this.px[n] = toU8(i);
    }
    get(n: number): number {
        return this.px[n] ?? 0;
    }
}

export class Canvas2D {
    readonly px: Uint8Array;
    constructor(
        readonly w: number,
        readonly h: number,
    ) {
        this.px = new Uint8Array(w * h);
    }
    fill(i: number): void {
        this.px.fill(toU8(i));
    }
    set(x: number, y: number, i: number): void {
        if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.px[y * this.w + x] = toU8(i);
    }
    setColumn(x: number, i: number): void {
        for (let y = 0; y < this.h; y++) this.set(x, y, i);
    }
    get(x: number, y: number): number {
        return this.px[y * this.w + x] ?? 0;
    }
}
