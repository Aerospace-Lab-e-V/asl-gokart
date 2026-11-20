#pragma once
/// Rear "Pulse": two breaths of light from the centre, each wider than the
/// last, then a ramp into the shape of the tail light so the welcome settles
/// into the real tail without a jump.
/// Port: infotainment/headunit/src/lib/lights/animations/rear/pulse.ts

#include <cmath>
#include <core/animation.hpp>
#include <core/light_layout.hpp>

namespace anim::rear_pulse {

constexpr uint32_t BREATH_MS  = 1100;
constexpr uint32_t BREATHS    = 2;
constexpr uint32_t RAMP_MS    = 400;
constexpr float    SIGMA_FROM = 0.2f;
constexpr float    SIGMA_TO   = 0.8f;
/// Intensity whose gamma output matches the tail level (80/255 → ≈ 0.59).
constexpr float    TAIL_MATCH = 0.59f;
constexpr float    TAU        = 6.2831853f;  // not TWO_PI: Arduino.h defines that as a macro

inline void render(uint32_t t, Canvas2D& out) {
    const uint32_t breathe_ms = BREATHS * BREATH_MS;
    const float half = out.w / 2.0f;

    if (t < breathe_ms) {
        const float b     = 0.5f - 0.5f * std::cos(TAU * static_cast<float>(t) / BREATH_MS);
        const float sigma = mixf(SIGMA_FROM, SIGMA_TO, static_cast<float>(t) / breathe_ms);
        for (uint16_t col = 0; col < out.w; ++col) {
            const float x = (col + 0.5f - half) / half / sigma;
            out.set_column(col, b * std::exp(-x * x));
        }
        return;
    }

    const float k = clamp01(static_cast<float>(t - breathe_ms) / RAMP_MS);
    for (uint16_t col = 0; col < out.w; ++col) out.set_column(col, RearLayout::in_center(col) ? k * TAIL_MATCH : 0.0f);
}

}  // namespace anim::rear_pulse

namespace anim {
inline constexpr RearAnimation kRearPulse{
    /*id*/ 2, "Pulse", /*duration*/ 2600, /*custom_color*/ true, {255, 0, 0}, rear_pulse::render};
}
