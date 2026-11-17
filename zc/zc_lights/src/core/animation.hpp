#pragma once
/// @file animation.hpp
/// Welcome animation descriptors. See animations/README.md for how to add one.
///
/// Contract for every render function:
///   - pure: no static or global state, same (t, canvas) → same pixels
///   - writes every pixel of the canvas
///   - writes perceptual intensity 0..1; gamma, ambient brightness and colour are
///     applied by the compositor
///   - t is clamped to [0, duration_ms] by the caller; the frame at t = duration_ms
///     is held until the welcome settles

#include <cstdint>
#include <core/canvas.hpp>
#include <core/color.hpp>

using FrontRenderFn = void (*)(uint32_t t_ms, Canvas1D& out);
using RearRenderFn  = void (*)(uint32_t t_ms, Canvas2D& out);

struct FrontAnimation {
    uint8_t       id;             ///< stable, stored in NVS — never renumber
    const char*   name;
    uint16_t      duration_ms;
    uint16_t      cue_ms;         ///< when the rear animation starts (front→rear choreography)
    bool          custom_color;   ///< the user may pick its colour
    Rgb8          default_color;
    FrontRenderFn render;
};

struct RearAnimation {
    uint8_t      id;              ///< stable, stored in NVS — never renumber
    const char*  name;
    uint16_t     duration_ms;
    bool         custom_color;
    Rgb8         default_color;
    RearRenderFn render;
};
