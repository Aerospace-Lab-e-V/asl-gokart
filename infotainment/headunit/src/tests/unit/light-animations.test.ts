import { ANIMATIONS, FRONT_ANIMATIONS, REAR_ANIMATIONS, WELCOME, welcomeTotalMs } from "@/domain/lights";
import { FRONT_RENDER, REAR_RENDER } from "@/lib/lights/animations";
import { Canvas1D, Canvas2D } from "@/lib/lights/canvas";
import { composeRear } from "@/lib/lights/compositor";
import { REAR } from "@/lib/lights/layout";
import { DARK_STATE } from "@/lib/lights/scene";
import { sampleFront, sampleRear, welcomeActive, type WelcomePlan } from "@/lib/lights/welcome-plan";

/* The TS ports must follow the same rules as the firmware (zc_lights/test/test_animations). */

const front = () => new Canvas1D(15);
const rear = () => new Canvas2D(REAR.WIDTH, REAR.HEIGHT);

test("every catalog animation has a renderer and unique ids", () => {
    for (const layer of ["front", "rear"] as const) {
        const ids = ANIMATIONS[layer].map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    }
    FRONT_ANIMATIONS.forEach((a) => expect(FRONT_RENDER[a.id]).toBeDefined());
    REAR_ANIMATIONS.forEach((a) => expect(REAR_RENDER[a.id]).toBeDefined());
});

test.each(FRONT_ANIMATIONS)("front $name is pure and ends fully lit", (a) => {
    for (let t = 0; t <= a.durationMs; t += 50) {
        const x = front();
        const y = front();
        y.px.fill(0xab);
        FRONT_RENDER[a.id](t, x);
        FRONT_RENDER[a.id](t, y);
        expect(y.px).toEqual(x.px);
    }
    const end = front();
    FRONT_RENDER[a.id](a.durationMs, end);
    expect([...end.px].every((v) => v === 255)).toBe(true);
});

test.each(REAR_ANIMATIONS)("rear $name is pure and mirror-symmetric", (a) => {
    for (let t = 0; t <= a.durationMs; t += 100) {
        const x = rear();
        const y = rear();
        y.px.fill(0xab);
        REAR_RENDER[a.id](t, x);
        REAR_RENDER[a.id](t, y);
        expect(y.px).toEqual(x.px);
        for (let row = 0; row < REAR.HEIGHT; row++)
            for (let col = 0; col < REAR.WIDTH / 2; col++) expect(x.get(col, row)).toBe(x.get(REAR.WIDTH - 1 - col, row));
    }
});

test("CCGT wing: dotted burst to half span, then solid full width", () => {
    const c = rear();
    REAR_RENDER[1](300, c);
    const half = [...Array(22).keys()].map((k) => c.get(80 + k, 0));
    expect(half.some((v) => v > 40)).toBe(true);
    expect(half.some((v) => v === 0)).toBe(true);
    expect(c.get(143, 0)).toBe(0);
    REAR_RENDER[1](1700, c);
    expect([...c.px].every((v) => v === 255)).toBe(true);
});

test("pods switch on one after another from the inner end", () => {
    const c = front();
    FRONT_RENDER[1](100, c);
    expect([c.get(0), c.get(4), c.get(5)]).toEqual([255, 255, 0]);
});

describe("welcome plan", () => {
    const plan: WelcomePlan = {
        t0: 1000,
        front: FRONT_ANIMATIONS[1],
        rear: REAR_ANIMATIONS[1],
        frontColor: [255, 255, 255],
        rearColor: [255, 0, 0],
        ambient: 255,
    };

    test("rear starts at the front's cue, both settle together", () => {
        expect(sampleRear(plan, 1000 + 599).phase).toBe("waiting");
        expect(sampleRear(plan, 1000 + 700)).toMatchObject({ phase: "playing", localT: 100 });
        expect(sampleFront(plan, 1000 + 2000)).toMatchObject({ phase: "holding", localT: 1300 });
        const settling = 1000 + 2300 + WELCOME.SETTLE_MS / 2;
        expect(sampleFront(plan, settling).phase).toBe("settling");
        expect(sampleRear(plan, settling).phase).toBe("settling");
        expect(welcomeActive(plan, 1000 + welcomeTotalMs(plan.front, plan.rear))).toBe(false);
    });

    test("a cancel fades out and never restarts", () => {
        const cancelled = { ...plan, cancelAt: 1900 };
        expect(sampleFront(cancelled, 1900 + 60)).toMatchObject({ phase: "cancelling", localT: 900 });
        expect(sampleFront(cancelled, 1900 + WELCOME.CANCEL_FADE_MS).phase).toBe("idle");
    });
});

test("the brake light covers the welcome in the centre", () => {
    const w = rear();
    w.px.fill(255);
    const out = new Uint8ClampedArray(REAR.WIDTH * REAR.HEIGHT * 4);
    composeRear({ ...DARK_STATE, brake: true }, { phase: "playing", localT: 0, alpha: 1 }, w, [0, 100, 255], 255, 0, out);
    expect([...out.subarray(70 * 4, 70 * 4 + 3)]).toEqual([255, 0, 0]);
    expect([...out.subarray(10 * 4, 10 * 4 + 3)]).toEqual([0, 100, 255]);
});
