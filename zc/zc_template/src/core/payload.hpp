#pragma once
/// @file payload.hpp
/// Sero payload encoding. Pure C++ (no Arduino.h), so it is unit-tested on the host:
/// `pio test -e native`. Keep logic that needs no hardware in src/core and the rest in src/.

#include <cstdint>

/// Writes `v` big-endian into p[0..3].
inline void put_u32_be(uint8_t* p, uint32_t v) {
    p[0] = static_cast<uint8_t>(v >> 24);
    p[1] = static_cast<uint8_t>(v >> 16);
    p[2] = static_cast<uint8_t>(v >> 8);
    p[3] = static_cast<uint8_t>(v);
}

/// Reads a big-endian u32 from p[0..3].
inline uint32_t get_u32_be(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) << 24 | static_cast<uint32_t>(p[1]) << 16 | static_cast<uint32_t>(p[2]) << 8 | p[3];
}
