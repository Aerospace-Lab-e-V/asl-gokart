#pragma once
/// Rear "Classic sweep": the original rear welcome, as a pure function of time.
///   Phase 1 — middle row only, centre → edges, dim
///   Phase 2 — all rows, edges → centre, dim (drawn over phase 1)
///   Phase 3 — all rows, centre → edges, full
/// Port: infotainment/headunit/src/lib/lights/animations/rear/classic.ts

#include <core/animation.hpp>

namespace anim::rear_classic {

constexpr uint32_t PHASE_MS = 800;
/// Intensity of phases 1–2; after gamma 2.2 this is ≈ 50 % output, as before.
constexpr float DIM = 0.73f;

inline void render(uint32_t t, Canvas2D& out) {
    const uint16_t half = out.w / 2;
    const auto reached = [&](uint32_t phase_start) -> uint16_t {
        if (t < phase_start) return 0;
        const float p = clamp01(static_cast<float>(t - phase_start) / PHASE_MS);
        return static_cast<uint16_t>(p * half);
    };
    const uint16_t r1 = reached(0), r2 = reached(PHASE_MS), r3 = reached(2 * PHASE_MS);
    const uint16_t middle = out.h / 2;

    for (uint16_t col = 0; col < out.w; ++col) {
        const uint16_t from_center = col < half ? (half - 1 - col) : (col - half);
        const uint16_t from_edge   = col < half ? col : (out.w - 1 - col);
        for (uint16_t row = 0; row < out.h; ++row) {
            float i = 0.0f;
            if (row == middle && from_center < r1) i = DIM;
            if (from_edge < r2) i = DIM;
            if (from_center < r3) i = 1.0f;
            out.set(col, row, i);
        }
    }
}

}  // namespace anim::rear_classic

namespace anim {
inline constexpr RearAnimation kRearClassic{
    /*id*/ 0, "Classic sweep", /*duration*/ 2400, /*custom_color*/ true, {0, 100, 255}, rear_classic::render};
}
