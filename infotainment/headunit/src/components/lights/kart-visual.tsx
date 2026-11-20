import React, { useEffect, useLayoutEffect, useRef } from "react";
import { useIsDark } from "@/hooks/use-is-dark";
import { FRONT, REAR } from "@/lib/lights/layout";
import { subscribeFrame } from "@/lib/lights/preview-clock";
import { LightScene, type LightState } from "@/lib/lights/scene";
import type { WelcomePlan } from "@/lib/lights/welcome-plan";
import { cn } from "@/lib/utils";
import { BUMPER_PATH, FRONT_VIEW, PODS, ledPosition } from "./kart-geometry";

/*
 * The kart's lights drawn from the front (DRL pods) and from behind (144 × 3 bar), rendered by the
 * same animations and compositor as the firmware. Canvas 2D only: the Pi 4 has no WebGL.
 * Draws on the shared preview clock while something moves, otherwise only when the inputs change.
 */

interface KartVisualProps {
    /** Light state at a given time (the live kart, or a fixed state for previews). */
    state: (now: number) => LightState;
    /** Welcome to show, or null. */
    plan: WelcomePlan | null;
    className?: string;
}

/** Colour of an unlit LED, so the strips stay visible. */
const OFF_DARK: [number, number, number] = [40, 44, 52];
const OFF_LIGHT: [number, number, number] = [203, 213, 225];

/** Rear bar drawn this many px tall per LED row. */
const REAR_ROW_PX = 7;

export function KartVisual({ state, plan, className }: KartVisualProps) {
    const frontRef = useRef<HTMLCanvasElement>(null);
    const rearRef = useRef<HTMLCanvasElement>(null);
    const dark = useIsDark();
    // Read at frame time; the frame loop is not restarted when they change.
    const planRef = useRef(plan);
    const stateRef = useRef(state);
    useLayoutEffect(() => {
        planRef.current = plan;
        stateRef.current = state;
    });

    useEffect(() => {
        const front = frontRef.current;
        const rear = rearRef.current;
        if (!front || !rear) return;
        const scene = new LightScene();
        const rearPixels = document.createElement("canvas");
        rearPixels.width = REAR.WIDTH;
        rearPixels.height = REAR.HEIGHT;
        const rearPixelsCtx = rearPixels.getContext("2d")!;
        const rearImage = rearPixelsCtx.createImageData(REAR.WIDTH, REAR.HEIGHT);
        // Lit LEDs only (dark ones transparent), for the glow.
        const rearGlow = document.createElement("canvas");
        rearGlow.width = REAR.WIDTH;
        rearGlow.height = REAR.HEIGHT;
        const rearGlowCtx = rearGlow.getContext("2d")!;
        const glowImage = rearGlowCtx.createImageData(REAR.WIDTH, REAR.HEIGHT);
        const off = dark ? OFF_DARK : OFF_LIGHT;
        let lastKey = "";

        const fit = (c: HTMLCanvasElement) => {
            const dpr = window.devicePixelRatio || 1;
            const w = Math.round(c.clientWidth * dpr);
            const h = Math.round(c.clientHeight * dpr);
            if (c.width !== w || c.height !== h) {
                c.width = w;
                c.height = h;
                lastKey = ""; // force a redraw
            }
        };

        const drawFront = () => {
            const ctx = front.getContext("2d")!;
            const scale = Math.min(front.width / FRONT_VIEW.w, front.height / FRONT_VIEW.h);
            const ox = (front.width - FRONT_VIEW.w * scale) / 2;
            const oy = (front.height - FRONT_VIEW.h * scale) / 2;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, front.width, front.height);
            ctx.setTransform(scale, 0, 0, scale, ox, oy);

            ctx.strokeStyle = dark ? "rgba(148,163,184,0.18)" : "rgba(71,85,105,0.25)";
            ctx.lineWidth = 1.5;
            ctx.stroke(new Path2D(BUMPER_PATH));

            for (const [pod, px] of [[PODS.left, scene.frontRight], [PODS.right, scene.frontLeft]] as const) {
                // Seen from the front, the kart's right side is on the left of the drawing.
                for (const strip of pod) {
                    for (let i = 0; i < FRONT.NUM_LEDS; i++) {
                        const { x, y } = ledPosition(strip, i, FRONT.NUM_LEDS);
                        drawLed(ctx, x, y, px[i * 4], px[i * 4 + 1], px[i * 4 + 2], off, dark);
                    }
                }
            }
        };

        const drawRear = () => {
            const ctx = rear.getContext("2d")!;
            const d = rearImage.data;
            const g = glowImage.data;
            const px = scene.rear;
            for (let i = 0; i < REAR.WIDTH * REAR.HEIGHT * 4; i += 4) {
                const lit = px[i] + px[i + 1] + px[i + 2] > 0;
                d[i] = lit ? px[i] : off[0];
                d[i + 1] = lit ? px[i + 1] : off[1];
                d[i + 2] = lit ? px[i + 2] : off[2];
                d[i + 3] = 255;
                g[i] = px[i];
                g[i + 1] = px[i + 1];
                g[i + 2] = px[i + 2];
                g[i + 3] = lit ? 255 : 0;
            }
            rearPixelsCtx.putImageData(rearImage, 0, 0);
            rearGlowCtx.putImageData(glowImage, 0, 0);

            const barH = REAR.HEIGHT * REAR_ROW_PX * (window.devicePixelRatio || 1);
            const y = (rear.height - barH) / 2;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, rear.width, rear.height);
            // Soft glow under the LEDs, then the LEDs themselves, crisp.
            ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
            ctx.globalAlpha = dark ? 0.35 : 0.15;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(rearGlow, 0, y - barH, rear.width, barH * 3);
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 1;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(rearPixels, 0, y, rear.width, barH);
        };

        const frame = (now: number) => {
            fit(front);
            fit(rear);
            const s = stateRef.current(now);
            const moving = scene.render(now, s, planRef.current);
            // Static scenes are drawn once per change.
            const key = moving ? String(now) : JSON.stringify(s) + (planRef.current?.t0 ?? "");
            if (key === lastKey) return;
            lastKey = key;
            drawFront();
            drawRear();
        };

        return subscribeFrame(frame);
    }, [dark]);

    return (
        <div className={cn("flex flex-col gap-6", className)}>
            <figure className="flex min-h-0 flex-[3] flex-col gap-2">
                <canvas ref={frontRef} className="min-h-0 w-full flex-1" aria-hidden />
                <figcaption className="text-muted-foreground text-center text-lg">Front</figcaption>
            </figure>
            <figure className="flex min-h-0 flex-[1] flex-col gap-2">
                <canvas ref={rearRef} className="min-h-0 w-full flex-1" aria-hidden />
                <figcaption className="text-muted-foreground text-center text-lg">Rear</figcaption>
            </figure>
        </div>
    );
}

/** One DRL LED: a dim dot when off, a dot with a soft halo when lit. */
function drawLed(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    off: [number, number, number],
    dark: boolean,
): void {
    const peak = Math.max(r, g, b);
    if (peak === 0) {
        ctx.fillStyle = `rgb(${off[0]},${off[1]},${off[2]})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    // Show the hue at full strength and carry the brightness in the alpha, so dim LEDs stay readable.
    const k = 255 / peak;
    const hue = `${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)}`;
    const level = peak / 255;
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    ctx.fillStyle = `rgba(${hue},${0.12 * level})`;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${hue},${0.3 * level})`;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(${hue},${0.35 + 0.65 * level})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
}
