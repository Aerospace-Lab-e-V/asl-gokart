#pragma once
/// @file welcome_plan.hpp
/// Timeline of one welcome, shared by the front and rear render tasks.
///
/// The plan is plain data. Each task copies it every frame and works out its
/// own phase from the shared millis() clock, so front and rear stay in sync
/// without handshakes:
///
///   t = 0             front starts (fade-in XFADE_IN_MS)      rear waits on its base
///   t = front.cue     rear starts (fade-in XFADE_IN_MS)
///   t = front.dur     front holds its last frame
///   t = end           both settle into DRL / tail over SETTLE_MS
///     end = max(front.dur, front.cue + rear.dur)
///
/// A cancel (brake, reverse, turn, moving) fades the welcome out over
/// CANCEL_FADE_MS from wherever it was; the plan is then dropped, never restarted.
/// Mirrored in infotainment/headunit/src/lib/lights/welcome-plan.ts — keep in sync.

#include <cstdint>
#include <core/color.hpp>

struct WelcomeTiming {
    static constexpr uint32_t START_LEAD_MS  = 20;
    static constexpr uint32_t XFADE_IN_MS    = 200;
    static constexpr uint32_t SETTLE_MS      = 400;
    static constexpr uint32_t CANCEL_FADE_MS = 120;
};

struct WelcomePlan {
    bool     armed = false;
    uint32_t t0_ms = 0;

    uint8_t  front_id = 0, rear_id = 0;
    uint16_t front_dur = 0, front_cue = 0, rear_dur = 0;
    Rgb8     front_color{}, rear_color{};
    uint8_t  ambient = 255;

    bool     cancelled = false;
    uint32_t cancel_ms = 0;
};

enum class LayerPhase : uint8_t { Idle, Waiting, Playing, Holding, Settling, Cancelling };

struct LayerSample {
    LayerPhase phase   = LayerPhase::Idle;
    uint32_t   local_t = 0;     ///< time to render the animation at
    float      alpha   = 0.0f;  ///< weight of the welcome over the base light

    bool draws() const { return phase != LayerPhase::Idle && phase != LayerPhase::Waiting; }
};

inline uint32_t welcome_end_ms(const WelcomePlan& p) {
    const uint32_t rear_end = static_cast<uint32_t>(p.front_cue) + p.rear_dur;
    return p.front_dur > rear_end ? p.front_dur : rear_end;
}

namespace welcome_detail {

inline float ramp(int32_t t, uint32_t len) { return t <= 0 ? 0.0f : (t >= static_cast<int32_t>(len) ? 1.0f : static_cast<float>(t) / len); }

/// One layer that starts `offset` ms after t0 and plays for `dur` ms.
inline LayerSample sample_layer(const WelcomePlan& p, uint32_t now, uint32_t offset, uint32_t dur) {
    const int32_t e = static_cast<int32_t>(now - p.t0_ms);
    const int32_t end = static_cast<int32_t>(welcome_end_ms(p));
    const int32_t local = e - static_cast<int32_t>(offset);

    if (local < 0) return {LayerPhase::Waiting, 0, 0.0f};
    if (local < static_cast<int32_t>(dur))
        return {LayerPhase::Playing, static_cast<uint32_t>(local), ramp(local, WelcomeTiming::XFADE_IN_MS)};
    if (e < end) return {LayerPhase::Holding, dur, 1.0f};
    if (e < end + static_cast<int32_t>(WelcomeTiming::SETTLE_MS))
        return {LayerPhase::Settling, dur, 1.0f - ramp(e - end, WelcomeTiming::SETTLE_MS)};
    return {LayerPhase::Idle, 0, 0.0f};
}

inline LayerSample sample(const WelcomePlan& p, uint32_t now, uint32_t offset, uint32_t dur) {
    if (!p.armed) return {};
    if (!p.cancelled) return sample_layer(p, now, offset, dur);

    const int32_t since = static_cast<int32_t>(now - p.cancel_ms);
    if (since >= static_cast<int32_t>(WelcomeTiming::CANCEL_FADE_MS)) return {};
    const LayerSample at_cancel = sample_layer(p, p.cancel_ms, offset, dur);
    if (!at_cancel.draws()) return {};
    return {LayerPhase::Cancelling, at_cancel.local_t, at_cancel.alpha * (1.0f - ramp(since, WelcomeTiming::CANCEL_FADE_MS))};
}

}  // namespace welcome_detail

inline LayerSample sample_front(const WelcomePlan& p, uint32_t now) {
    return welcome_detail::sample(p, now, 0, p.front_dur);
}

inline LayerSample sample_rear(const WelcomePlan& p, uint32_t now) {
    return welcome_detail::sample(p, now, p.front_cue, p.rear_dur);
}

/// True until the welcome has settled or its cancel fade is over.
inline bool welcome_active(const WelcomePlan& p, uint32_t now) {
    if (!p.armed) return false;
    if (p.cancelled) return static_cast<int32_t>(now - p.cancel_ms) < static_cast<int32_t>(WelcomeTiming::CANCEL_FADE_MS);
    return static_cast<int32_t>(now - p.t0_ms) < static_cast<int32_t>(welcome_end_ms(p) + WelcomeTiming::SETTLE_MS);
}
