#pragma once
/// @file led_animation.hpp
/// Abstract interface for LED strip animations.
///
/// All animations implement ILedAnimation and are driven frame-by-frame
/// by their owning controller.  This keeps animation rendering logic
/// cleanly separated from the controller's state-machine / business logic.

#include <cstdint>
#include <NeoPixelBus.h>

/// The rear light bar's LEDs take their bytes in R, G, B order, unlike the
/// front DRL strips (G, R, B). With the matching feature, RgbColor values are
/// true colors on both, so one welcome color looks the same front and rear.
using RearStrip = NeoPixelBus<NeoRgbFeature, NeoEsp32Rmt0Ws2812xMethod>;

/// Pixel-index mapping function type.
/// Maps (column, row) in a logical matrix to a physical strip index.
using PixelIndexFn = uint16_t (*)(uint16_t col, uint16_t row);

/// Abstract base for all LED strip animations.
///
/// Lifecycle:
///   1. Call start() once to initialise / reset the animation.
///   2. Call tick() every frame (~20 ms).  It writes pixels directly
///      to the strip buffer and returns true while the animation is
///      still running.  When it returns false the animation is done.
///
/// The caller is responsible for calling strip->Show() after tick().
class ILedAnimation {
public:
    virtual ~ILedAnimation() = default;

    /// Reset internal state and prepare for playback.
    virtual void start() = 0;

    /// Render one frame into the strip buffer.
    ///
    /// @param strip         NeoPixelBus strip to write pixels to.
    /// @param elapsed_ms    Milliseconds elapsed since start() was called.
    /// @param width         Matrix width  (columns).
    /// @param height        Matrix height (rows).
    /// @param pixel_index   Mapping function: (col, row) → strip index.
    /// @param brightness    Global brightness multiplier (0–255).
    /// @return true while the animation is still playing, false when done.
    virtual bool tick(RearStrip* strip,
                      uint32_t elapsed_ms,
                      uint16_t width,
                      uint16_t height,
                      PixelIndexFn pixel_index,
                      uint8_t  brightness) = 0;
};
