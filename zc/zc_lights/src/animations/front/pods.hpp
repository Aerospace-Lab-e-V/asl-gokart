#pragma once
/// Front "Pods": the strip is split into three pods of 5 px that switch on one
/// after another from the inner end outward, like the stepped DRL pods of the
/// Koenigsegg CCGT reveal.
/// Port: infotainment/headunit/src/lib/lights/animations/front/pods.ts

#include <core/animation.hpp>

namespace anim::front_pods {

constexpr uint16_t POD_PX  = 5;
constexpr uint32_t STEP_MS = 250;  // delay between pods
constexpr uint32_t RISE_MS = 90;   // each pod's switch-on ramp

inline void render(uint32_t t, Canvas1D& out) {
    for (uint16_t i = 0; i < out.len; ++i) {
        const uint16_t pod = i / POD_PX;
        const float on = smooth01((static_cast<float>(t) - pod * STEP_MS) / RISE_MS);
        out.set(i, on);
    }
}

}  // namespace anim::front_pods

namespace anim {
inline constexpr FrontAnimation kFrontPods{
    /*id*/ 1, "Pods", /*duration*/ 1300, /*cue*/ 600, /*custom_color*/ true, {255, 255, 255}, front_pods::render};
}
