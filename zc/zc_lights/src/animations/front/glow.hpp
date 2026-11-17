#pragma once
/// Front "Glow": the whole strip fades up, then holds. The original welcome.
/// Port: infotainment/headunit/src/lib/lights/animations/front/glow.ts

#include <core/animation.hpp>

namespace anim::front_glow {

constexpr uint32_t FADE_MS = 3000;

inline void render(uint32_t t, Canvas1D& out) { out.fill(static_cast<float>(t) / FADE_MS); }

}  // namespace anim::front_glow

namespace anim {
inline constexpr FrontAnimation kFrontGlow{
    /*id*/ 0, "Glow", /*duration*/ 3500, /*cue*/ 3000, /*custom_color*/ true, {0, 100, 255}, front_glow::render};
}
