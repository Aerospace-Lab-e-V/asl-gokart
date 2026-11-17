#pragma once
/// @file canvas.hpp
/// Logical intensity canvases the animations draw into.
///
/// Animations are monochrome: each pixel holds a perceptual intensity 0..255.
/// The compositor applies gamma, ambient brightness and the animation colour, so
/// gamma never shifts a colour's hue and an animation never needs to know its colour.
/// Layout is logical (row-major, index 0 = inner end for the front strips); the
/// controllers map to the physical wiring.

#include <cstdint>
#include <core/easing.hpp>

namespace canvas_detail {
constexpr uint8_t to_u8(float i) { return static_cast<uint8_t>(clamp01(i) * 255.0f + 0.5f); }
}  // namespace canvas_detail

struct Canvas1D {
    uint8_t* px;
    uint16_t len;

    void fill(float i) {
        const uint8_t v = canvas_detail::to_u8(i);
        for (uint16_t n = 0; n < len; ++n) px[n] = v;
    }
    void set(uint16_t n, float i) {
        if (n < len) px[n] = canvas_detail::to_u8(i);
    }
    uint8_t get(uint16_t n) const { return n < len ? px[n] : 0; }
};

struct Canvas2D {
    uint8_t* px;
    uint16_t w, h;

    void fill(float i) {
        const uint8_t v = canvas_detail::to_u8(i);
        for (uint32_t n = 0; n < static_cast<uint32_t>(w) * h; ++n) px[n] = v;
    }
    void set(uint16_t x, uint16_t y, float i) {
        if (x < w && y < h) px[y * w + x] = canvas_detail::to_u8(i);
    }
    void set_column(uint16_t x, float i) {
        for (uint16_t y = 0; y < h; ++y) set(x, y, i);
    }
    uint8_t get(uint16_t x, uint16_t y) const { return (x < w && y < h) ? px[y * w + x] : 0; }
};
