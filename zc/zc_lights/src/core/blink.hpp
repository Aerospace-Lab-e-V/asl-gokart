#pragma once
/// @file blink.hpp
/// Turn-signal timing as a pure function of time. Front and rear evaluate the
/// same epoch, so they blink in phase without talking to each other.
///
///   0 ─ SWEEP_MS        sweep: the lit part grows from the inner end outward
///   SWEEP_MS ─ +HOLD_MS fully lit
///   … ─ CYCLE_MS        off

#include <cstdint>

struct Blink {
    static constexpr uint32_t SWEEP_MS = 400;
    static constexpr uint32_t HOLD_MS  = 20;
    static constexpr uint32_t CYCLE_MS = 700;  // sweep + hold + off (≈ 280 ms)

    /// True while the lamp is (partly) lit; drives the physical blink event.
    bool  lit;
    /// Fraction of the zone lit, 0..1 (1 during the hold).
    float progress;
};

inline Blink blink_at(uint32_t now_ms, uint32_t epoch_ms) {
    const uint32_t t = (now_ms - epoch_ms) % Blink::CYCLE_MS;
    if (t < Blink::SWEEP_MS) return {true, static_cast<float>(t) / Blink::SWEEP_MS};
    if (t < Blink::SWEEP_MS + Blink::HOLD_MS) return {true, 1.0f};
    return {false, 0.0f};
}
