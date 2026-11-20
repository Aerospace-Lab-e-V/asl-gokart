#pragma once
/// Front "Sweep": the strip fills from the inner end outward with a soft,
/// eased leading edge.
/// Port: infotainment/headunit/src/lib/lights/animations/front/sweep.ts

#include <core/animation.hpp>

namespace anim::front_sweep {

constexpr uint32_t FILL_MS = 1100;
constexpr float    EDGE_PX = 3.0f;  // width of the soft leading edge

/// Fill of pixel i when the head of the sweep is at `head` (px from the inner end).
constexpr float fill_at(float head, uint16_t i) { return clamp01((head - i) / EDGE_PX); }

inline void render(uint32_t t, Canvas1D& out) {
    const float head = ease_in_out(static_cast<float>(t) / FILL_MS) * (out.len + EDGE_PX);
    for (uint16_t i = 0; i < out.len; ++i) out.set(i, fill_at(head, i));
}

}  // namespace anim::front_sweep

namespace anim {
inline constexpr FrontAnimation kFrontSweep{
    /*id*/ 2, "Sweep", /*duration*/ 1500, /*cue*/ 1100, /*custom_color*/ true, {0, 100, 255}, front_sweep::render};
}
