// Port of zc/zc_lights/src/core/easing.hpp — keep in sync.
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const smooth01 = (x: number): number => {
    x = clamp01(x);
    return x * x * (3 - 2 * x);
};

export const smoothstep = (e0: number, e1: number, x: number): number => smooth01((x - e0) / (e1 - e0));

export const easeInOut = (x: number): number => {
    x = clamp01(x);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

export const mixf = (a: number, b: number, t: number): number => a + (b - a) * t;
