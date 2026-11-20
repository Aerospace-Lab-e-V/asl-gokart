import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { AnimationInfo, Rgb } from "@/domain/lights";
import { useIsDark } from "@/hooks/use-is-dark";
import { Canvas1D, Canvas2D } from "@/lib/lights/canvas";
import { FRONT, REAR } from "@/lib/lights/layout";
import { subscribeFrame } from "@/lib/lights/preview-clock";
import { renderAnimationOnly } from "@/lib/lights/scene";
import { cn } from "@/lib/utils";
import { FRONT_VIEW, PODS, ledPosition } from "./kart-geometry";

/** Pause after each loop, holding the final frame. */
const LOOP_PAUSE_MS = 900;

interface AnimationTileProps {
    animation: AnimationInfo;
    color: Rgb;
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
}

/** A tappable tile that loops its animation in miniature. Only draws while on screen. */
export function AnimationTile({ animation, color, selected, disabled, onSelect }: AnimationTileProps) {
    const ref = useRef<HTMLCanvasElement>(null);
    const dark = useIsDark();
    const colorRef = useRef(color);
    useLayoutEffect(() => {
        colorRef.current = color;
    });

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const front = new Canvas1D(FRONT.NUM_LEDS);
        const rear = new Canvas2D(REAR.WIDTH, REAR.HEIGHT);
        const px = new Uint8ClampedArray((animation.layer === "front" ? FRONT.NUM_LEDS : REAR.WIDTH * REAR.HEIGHT) * 4);
        const offscreen = document.createElement("canvas");
        offscreen.width = REAR.WIDTH;
        offscreen.height = REAR.HEIGHT;
        const offCtx = offscreen.getContext("2d")!;
        const image = offCtx.createImageData(REAR.WIDTH, REAR.HEIGHT);
        const off = dark ? "rgb(40,44,52)" : "rgb(203,213,225)";
        const period = animation.durationMs + LOOP_PAUSE_MS;
        let start = 0;

        const frame = (now: number) => {
            const dpr = window.devicePixelRatio || 1;
            const w = Math.round(canvas.clientWidth * dpr);
            const h = Math.round(canvas.clientHeight * dpr);
            if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
            if (!start) start = now;
            const t = Math.min((now - start) % period, animation.durationMs);
            renderAnimationOnly(animation.layer, animation.id, t, colorRef.current, front, rear, px);

            const ctx = canvas.getContext("2d")!;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, w, h);
            if (animation.layer === "front") {
                const scale = Math.min(w / FRONT_VIEW.w, h / FRONT_VIEW.h);
                ctx.setTransform(scale, 0, 0, scale, (w - FRONT_VIEW.w * scale) / 2, (h - FRONT_VIEW.h * scale) / 2);
                for (const strip of [...PODS.left, ...PODS.right]) {
                    for (let i = 0; i < FRONT.NUM_LEDS; i++) {
                        const { x, y } = ledPosition(strip, i, FRONT.NUM_LEDS);
                        const [r, g, b] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
                        ctx.fillStyle = r + g + b ? `rgb(${r},${g},${b})` : off;
                        ctx.beginPath();
                        ctx.arc(x, y, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            } else {
                const d = image.data;
                for (let i = 0; i < px.length; i += 4) {
                    const lit = px[i] + px[i + 1] + px[i + 2] > 0;
                    d[i] = lit ? px[i] : dark ? 40 : 203;
                    d[i + 1] = lit ? px[i + 1] : dark ? 44 : 213;
                    d[i + 2] = lit ? px[i + 2] : dark ? 52 : 225;
                    d[i + 3] = 255;
                }
                offCtx.putImageData(image, 0, 0);
                ctx.imageSmoothingEnabled = false;
                const barH = Math.round(h * 0.22);
                ctx.drawImage(offscreen, 0, (h - barH) / 2, w, barH);
            }
        };

        // Animate only while visible.
        let unsubscribe: (() => void) | null = null;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && !unsubscribe) unsubscribe = subscribeFrame(frame);
            else if (!entry.isIntersecting && unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
        });
        observer.observe(canvas);
        return () => {
            observer.disconnect();
            unsubscribe?.();
        };
    }, [animation, dark]);

    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={onSelect}
            className={cn(
                "bg-muted/40 active:bg-accent focus-visible:ring-ring flex flex-col gap-3 rounded-2xl p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
                selected && "ring-foreground ring-2",
            )}
        >
            <canvas ref={ref} className="h-28 w-full" aria-hidden />
            <span className="flex items-center gap-2 text-xl">
                {animation.name}
                {selected && <Check className="ml-auto h-6 w-6" strokeWidth={3} aria-hidden />}
            </span>
        </button>
    );
}
