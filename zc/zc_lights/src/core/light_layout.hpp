#pragma once
/// @file light_layout.hpp
/// Geometry, zones and the fixed levels of the safety lights.
/// Mirrored in infotainment/headunit/src/lib/lights/layout.ts — keep in sync.

#include <cstdint>
#include <core/color.hpp>

/// Turn signal / hazard state.
enum class BlinkerState : uint8_t { OFF = 0, LEFT = 1, RIGHT = 2, HAZARD = 3 };

constexpr bool blinks_left(BlinkerState s) { return s == BlinkerState::LEFT || s == BlinkerState::HAZARD; }
constexpr bool blinks_right(BlinkerState s) { return s == BlinkerState::RIGHT || s == BlinkerState::HAZARD; }

// ── Front DRL ───────────────────────────────────────────────────────
// Each side has an upper (diagonal) and a lower strip wired in parallel on one
// data pin, so a side is one logical 15 px strip. Index 0 is the inner end
// (towards the bumper centre, where the wires enter), 14 the outer end.
struct FrontLayout {
    static constexpr uint16_t NUM_LEDS = 15;

    static constexpr uint8_t BRIGHTNESS_DRL  = 128;
    static constexpr uint8_t BRIGHTNESS_TURN = 128;

    static constexpr Rgb8 COLOR_DRL{255, 255, 255};
    static constexpr Rgb8 COLOR_TURN{255, 40, 0};
};

// ── Rear light bar (144 × 3) ────────────────────────────────────────
//  Zone layout (per row of 144 columns, column 0 = left seen from behind):
//  ┌─────────────┬───────┬──────────┬───────┬─────────────┐
//  │ TURN LEFT   │ REV L │  BRAKE   │ REV R │ TURN RIGHT  │
//  │ cols  0–35  │ 36–53 │  54–89   │ 90–107│ cols 108–143│
//  └─────────────┴───────┴──────────┴───────┴─────────────┘
//  Tail and brake light the whole centre (36–107); reverse sits on top of brake.
struct RearLayout {
    static constexpr uint16_t WIDTH    = 144;
    static constexpr uint16_t HEIGHT   = 3;
    static constexpr uint16_t NUM_LEDS = WIDTH * HEIGHT;

    static constexpr uint16_t TURN_SIGNAL_WIDTH = 36;
    static constexpr uint16_t TURN_LEFT_END     = TURN_SIGNAL_WIDTH;          // exclusive
    static constexpr uint16_t TURN_RIGHT_START  = WIDTH - TURN_SIGNAL_WIDTH;  // 108

    static constexpr uint16_t CENTER_START = TURN_LEFT_END;     // 36
    static constexpr uint16_t CENTER_END   = TURN_RIGHT_START;  // 108 (exclusive)

    static constexpr uint16_t REVERSE_ZONE_WIDTH  = 18;
    static constexpr uint16_t REVERSE_LEFT_END    = CENTER_START + REVERSE_ZONE_WIDTH;  // 54
    static constexpr uint16_t REVERSE_RIGHT_START = CENTER_END - REVERSE_ZONE_WIDTH;    // 90

    static constexpr uint8_t BRIGHTNESS_TAIL    = 80;
    static constexpr uint8_t BRIGHTNESS_BRAKE   = 255;
    static constexpr uint8_t BRIGHTNESS_REVERSE = 200;
    static constexpr uint8_t BRIGHTNESS_TURN    = 255;

    static constexpr Rgb8 COLOR_TAIL{255, 0, 0};
    static constexpr Rgb8 COLOR_BRAKE{255, 0, 0};
    static constexpr Rgb8 COLOR_TURN{255, 40, 0};
    static constexpr Rgb8 COLOR_REVERSE{255, 255, 255};

    static constexpr bool in_center(uint16_t col) { return col >= CENTER_START && col < CENTER_END; }
    static constexpr bool in_reverse(uint16_t col) {
        return (col >= CENTER_START && col < REVERSE_LEFT_END) || (col >= REVERSE_RIGHT_START && col < CENTER_END);
    }
};
