#pragma once
/// Rear "CCGT Wing": after the Koenigsegg CCGT rear-wing light bar reveal.
/// All three rows act as one wing line (the lower-ring stage of the original is
/// skipped, our bar has no separate rings).
///
///   0.0–0.5 s  dotted burst: a solid core plus alternating lit/dark groups
///              expand from the centre to 50 % span, dimming towards the edge
///   0.5–1.2 s  the dark groups fill in while the line sweeps (eased) to the ends
///   1.2–1.7 s  solid full-width line (held until the welcome settles)
///
/// Differences from the reference shader:
///   - time re-based: t here = reference t − 0.6 s (stage 0 skipped)
///   - the comb works on groups of COMB_PX columns: 144 px is about twice the
///     density of the original's 64–80 zones, single-pixel dots would blur
///   - an explicit radial falloff (100 % core → ~20 % at half span) during the burst
///   - the radius grows to 1 + END_FEATHER so the outermost columns end fully lit
///   - no pow(2.2) here; the compositor applies gamma
/// Port: infotainment/headunit/src/lib/lights/animations/rear/wing.ts

#include <cmath>
#include <core/animation.hpp>

namespace anim::rear_wing {

constexpr float    BURST_S     = 0.5f;   // phase 1 length
constexpr float    SWEEP_S     = 0.7f;   // phase 2 length
constexpr float    CORE        = 0.07f;  // solid centre core, |x| ≤ CORE
constexpr uint16_t COMB_PX     = 3;      // columns per dot / gap; tune on the kart (2–4)
constexpr float    FALLOFF     = 0.8f;   // dots at half span sit at 1 − FALLOFF
constexpr float    END_FEATHER = 0.1f;   // feather left at the end of the sweep

/// Intensity of one column; `col` 0..w-1, all rows share it.
inline float column(uint32_t t_ms, uint16_t col, uint16_t w) {
    const float tb  = static_cast<float>(t_ms) / 1000.0f;
    const float p1  = clamp01(tb / BURST_S);
    const float p2e = smooth01((tb - BURST_S) / SWEEP_S);

    const float half    = w / 2.0f;
    const float d       = std::fabs((col + 0.5f - half) / half);
    const float feather = 0.25f * (1.0f - 0.6f * p2e);
    const float radius  = 0.5f * p1 + (0.5f + END_FEATHER) * p2e;

    float envelope = 1.0f;
    if (d > radius) envelope = 0.0f;
    else if (d > radius - feather && feather > 0.0f) envelope = (radius - d) / feather;

    // Mirror-symmetric groups: the two centre columns are distance 0.
    const float dist_px = std::fabs(col + 0.5f - half) - 0.5f;
    const bool  dot     = (static_cast<uint16_t>(dist_px) / COMB_PX) % 2 == 0;
    const float comb    = (d <= CORE || dot) ? 1.0f : p2e;

    const float falloff = mixf(1.0f - FALLOFF * smoothstep(CORE, 0.5f, d), 1.0f, p2e);

    return envelope * comb * falloff;
}

inline void render(uint32_t t, Canvas2D& out) {
    for (uint16_t col = 0; col < out.w; ++col) out.set_column(col, column(t, col, out.w));
}

}  // namespace anim::rear_wing

namespace anim {
inline constexpr RearAnimation kRearWing{
    /*id*/ 1, "CCGT Wing", /*duration*/ 1700, /*custom_color*/ false, {255, 0, 0}, rear_wing::render};
}
