#pragma once
/// @file compositor.hpp
/// Builds one frame from the light state. Layers, bottom to top:
///   1. base     DRL white (front) / tail red in the centre (rear), fixed levels
///   2. welcome  animation intensity → gamma → × ambient → × colour, blended over
///               the base by the plan's alpha. Ambient brightness only acts here.
///   3. safety   brake, reverse, turn — opaque within their zone, always at their
///               fixed level, never delayed by the welcome
/// Output is logical (row-major, front index 0 = inner end); the controllers map
/// it to the physical wiring.
/// Mirrored in infotainment/headunit/src/lib/lights/compositor.ts — keep in sync.

#include <cstdint>
#include <core/blink.hpp>
#include <core/canvas.hpp>
#include <core/gamma.hpp>
#include <core/light_layout.hpp>
#include <core/welcome_plan.hpp>

namespace compose_detail {

/// Colour of a welcome pixel: gamma on the intensity, then ambient and colour.
inline Rgb8 welcome_pixel(uint8_t intensity, Rgb8 color, uint8_t ambient) {
    return scale(color, (gamma8(intensity) / 255.0f) * (ambient / 255.0f));
}

inline Rgb8 level(Rgb8 color, uint8_t brightness) { return scale(color, brightness / 255.0f); }

}  // namespace compose_detail

struct FrontInputs {
    bool     drl;
    bool     turn;            ///< this side's indicator is on
    uint32_t turn_epoch_ms;
};

/// One front side. `welcome` is the shared animation canvas (ignored unless ls.draws()).
inline void compose_front(const FrontInputs& in, const LayerSample& ls, const Canvas1D& welcome,
                          Rgb8 color, uint8_t ambient, uint32_t now, Rgb8* out, uint16_t len) {
    using L = FrontLayout;
    using namespace compose_detail;

    if (in.turn) {
        // The indicator owns the whole strip: sweep from the inner end, then dark.
        const Blink b = blink_at(now, in.turn_epoch_ms);
        const uint16_t lit = b.lit ? static_cast<uint16_t>(b.progress * len + 0.5f) : 0;
        const Rgb8 turn = level(L::COLOR_TURN, L::BRIGHTNESS_TURN);
        for (uint16_t i = 0; i < len; ++i) out[i] = i < lit ? turn : RGB_OFF;
        return;
    }

    const Rgb8 base = in.drl ? level(L::COLOR_DRL, L::BRIGHTNESS_DRL) : RGB_OFF;
    for (uint16_t i = 0; i < len; ++i) {
        out[i] = ls.draws() ? lerp(base, welcome_pixel(welcome.get(i), color, ambient), ls.alpha) : base;
    }
}

struct RearInputs {
    bool         tail, brake, reverse;
    BlinkerState turn;
    uint32_t     turn_epoch_ms;
};

/// The whole rear bar, `out` row-major width × height.
inline void compose_rear(const RearInputs& in, const LayerSample& ls, const Canvas2D& welcome,
                         Rgb8 color, uint8_t ambient, uint32_t now, Rgb8* out) {
    using L = RearLayout;
    using namespace compose_detail;

    const Blink b = blink_at(now, in.turn_epoch_ms);
    const bool turning = in.turn != BlinkerState::OFF && b.lit;
    const uint16_t turn_lit = static_cast<uint16_t>(b.progress * L::TURN_SIGNAL_WIDTH + 0.5f);

    const Rgb8 tail    = level(L::COLOR_TAIL, L::BRIGHTNESS_TAIL);
    const Rgb8 brake   = level(L::COLOR_BRAKE, L::BRIGHTNESS_BRAKE);
    const Rgb8 reverse = level(L::COLOR_REVERSE, L::BRIGHTNESS_REVERSE);
    const Rgb8 turn    = level(L::COLOR_TURN, L::BRIGHTNESS_TURN);

    for (uint16_t col = 0; col < L::WIDTH; ++col) {
        // Safety layer for this column, if any (opaque).
        bool safety = false;
        Rgb8 safe = RGB_OFF;
        if (turning && blinks_left(in.turn) && col < L::TURN_LEFT_END) {
            // Left sweeps outward: column 35 first, column 0 last.
            safety = true;
            safe = (L::TURN_LEFT_END - 1 - col) < turn_lit ? turn : RGB_OFF;
        } else if (turning && blinks_right(in.turn) && col >= L::TURN_RIGHT_START) {
            safety = true;
            safe = (col - L::TURN_RIGHT_START) < turn_lit ? turn : RGB_OFF;
        } else if (in.reverse && L::in_reverse(col)) {
            safety = true;
            safe = reverse;
        } else if (in.brake && L::in_center(col)) {
            safety = true;
            safe = brake;
        }

        const Rgb8 base = (in.tail && L::in_center(col)) ? tail : RGB_OFF;
        for (uint16_t row = 0; row < L::HEIGHT; ++row) {
            Rgb8 px = base;
            if (safety) px = safe;
            else if (ls.draws()) px = lerp(base, welcome_pixel(welcome.get(col, row), color, ambient), ls.alpha);
            out[row * L::WIDTH + col] = px;
        }
    }
}
