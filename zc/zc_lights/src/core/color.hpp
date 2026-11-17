#pragma once
/// @file color.hpp
/// Hardware-independent 8-bit RGB colour. Nothing in core/ includes Arduino or
/// NeoPixelBus, so it builds and runs in the native unit tests.

#include <cstdint>

struct Rgb8 {
    uint8_t r = 0, g = 0, b = 0;

    constexpr bool operator==(const Rgb8& o) const { return r == o.r && g == o.g && b == o.b; }
    constexpr bool operator!=(const Rgb8& o) const { return !(*this == o); }
};

inline constexpr Rgb8 RGB_OFF{0, 0, 0};

namespace color_detail {
constexpr uint8_t round_u8(float v) {
    return v <= 0.0f ? 0 : v >= 255.0f ? 255 : static_cast<uint8_t>(v + 0.5f);
}
}  // namespace color_detail

/// Colour multiplied by k (clamped to 0..1).
constexpr Rgb8 scale(Rgb8 c, float k) {
    k = k < 0.0f ? 0.0f : (k > 1.0f ? 1.0f : k);
    return {color_detail::round_u8(c.r * k), color_detail::round_u8(c.g * k), color_detail::round_u8(c.b * k)};
}

/// Linear blend from a (t = 0) to b (t = 1), t clamped to 0..1.
constexpr Rgb8 lerp(Rgb8 a, Rgb8 b, float t) {
    t = t < 0.0f ? 0.0f : (t > 1.0f ? 1.0f : t);
    return {color_detail::round_u8(a.r + (b.r - a.r) * t),
            color_detail::round_u8(a.g + (b.g - a.g) * t),
            color_detail::round_u8(a.b + (b.b - a.b) * t)};
}
