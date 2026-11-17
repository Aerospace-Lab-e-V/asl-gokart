#pragma once
/// @file easing.hpp
/// Small easing helpers shared by the animations.
/// Mirrored in infotainment/headunit/src/lib/lights/easing.ts — keep in sync.

constexpr float clamp01(float x) { return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x); }

/// Hermite smoothstep of x already in 0..1.
constexpr float smooth01(float x) {
    x = clamp01(x);
    return x * x * (3.0f - 2.0f * x);
}

/// GLSL smoothstep: 0 below e0, 1 above e1, smooth in between.
constexpr float smoothstep(float e0, float e1, float x) { return smooth01((x - e0) / (e1 - e0)); }

/// Cubic ease-in-out of x in 0..1.
constexpr float ease_in_out(float x) {
    x = clamp01(x);
    return x < 0.5f ? 4.0f * x * x * x : 1.0f - (-2.0f * x + 2.0f) * (-2.0f * x + 2.0f) * (-2.0f * x + 2.0f) / 2.0f;
}

constexpr float mixf(float a, float b, float t) { return a + (b - a) * t; }
