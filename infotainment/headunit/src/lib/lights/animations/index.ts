// The render function per animation id, like zc/zc_lights/src/animations/registry.hpp.
// Metadata (names, timings, colours) is in src/domain/lights.ts.
import type { Canvas1D, Canvas2D } from "../canvas";
import * as glow from "./front/glow";
import * as pods from "./front/pods";
import * as sweep from "./front/sweep";
import * as scan from "./front/scan";
import * as classic from "./rear/classic";
import * as wing from "./rear/wing";
import * as pulse from "./rear/pulse";

export type FrontRender = (t: number, out: Canvas1D) => void;
export type RearRender = (t: number, out: Canvas2D) => void;

export const FRONT_RENDER: Record<number, FrontRender> = { 0: glow.render, 1: pods.render, 2: sweep.render, 3: scan.render };
export const REAR_RENDER: Record<number, RearRender> = { 0: classic.render, 1: wing.render, 2: pulse.render };
