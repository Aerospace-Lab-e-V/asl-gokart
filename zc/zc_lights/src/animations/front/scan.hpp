#pragma once
/// Front "Scan": a comet runs from the inner end to the outer end and back,
/// then the strip fills like Sweep.
/// Port: infotainment/headunit/src/lib/lights/animations/front/scan.ts

#include <cmath>
#include <animations/front/sweep.hpp>

namespace anim::front_scan {

constexpr uint32_t LEG_MS  = 500;   // one direction of the comet
constexpr uint32_t FILL_MS = 600;
constexpr float    TAIL_PX = 1.5f;  // exponential tail length behind the head

inline void render(uint32_t t, Canvas1D& out) {
    const float last = static_cast<float>(out.len - 1);

    if (t < 2 * LEG_MS) {
        const bool outward = t < LEG_MS;
        const float k = static_cast<float>(outward ? t : t - LEG_MS) / LEG_MS;
        const float head = outward ? k * last : (1.0f - k) * last;
        for (uint16_t i = 0; i < out.len; ++i) {
            // Distance behind the head (the side it came from) gets the tail;
            // ahead of the head the light drops off within one pixel.
            const float behind = outward ? head - i : i - head;
            out.set(i, behind >= 0.0f ? std::exp(-behind / TAIL_PX) : clamp01(1.0f + behind));
        }
        return;
    }

    const float k = static_cast<float>(t - 2 * LEG_MS) / FILL_MS;
    const float head = ease_in_out(k) * (out.len + front_sweep::EDGE_PX);
    for (uint16_t i = 0; i < out.len; ++i) out.set(i, front_sweep::fill_at(head, i));
}

}  // namespace anim::front_scan

namespace anim {
inline constexpr FrontAnimation kFrontScan{
    /*id*/ 3, "Scan", /*duration*/ 2200, /*cue*/ 1600, /*custom_color*/ true, {0, 100, 255}, front_scan::render};
}
