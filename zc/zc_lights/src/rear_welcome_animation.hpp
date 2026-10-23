#pragma once
/// @file rear_welcome_animation.hpp
/// Multi-phase welcome sweep animation for the rear 144×3 LED matrix.
///
/// Phase sequence:
///   Phase 0 — All off (implicit, no duration)
///   Phase 1 — Middle row only: sweep from center cols 71/72 outward to
///             both edges at 50 % brightness.
///   Phase 2 — All 3 rows: sweep from both edges inward to center at 50 %.
///   Phase 3 — All 3 rows: sweep from center outward to both edges at 100 %.
///   Done    — tick() returns false, controller resumes normal driving mode.

#include <led_animation.hpp>
#include <algorithm>

/// Forward-declare config so the header is self-contained.
struct WelcomeConfig;

class RearWelcomeAnimation : public ILedAnimation {
public:
    /// @param color       Welcome color (shared with DRLs).
    /// @param sweep_ms    Duration of each sweep phase (ms).
    /// @param pause_ms    Pause between phases (ms).
    RearWelcomeAnimation(RgbColor color, uint32_t sweep_ms, uint32_t pause_ms)
        : color_(color)
        , sweep_ms_(sweep_ms)
        , pause_ms_(pause_ms)
        , started_(false)
    {}

    /// Update the welcome color (e.g. from a Sero SET_WELCOME_COLOR call).
    void set_color(RgbColor c) { color_ = c; }

    void start() override {
        started_ = true;
        phase_   = 0;
        clear_on_next_tick_ = true;
    }

    bool tick(RearStrip* strip,
              uint32_t elapsed_ms,
              uint16_t width,
              uint16_t height,
              PixelIndexFn pixel_index,
              uint8_t  brightness) override
    {
        if (!started_) return false;

        if (clear_on_next_tick_) {
            for (uint16_t i = 0; i < width * height; ++i) {
                strip->SetPixelColor(i, RgbColor(0, 0, 0));
            }
            clear_on_next_tick_ = false;
        }

        const uint16_t center_left  = (width / 2) - 1;   // 71
        const uint16_t center_right = width / 2;          // 72
        const uint16_t half_width   = width / 2;          // 72 cols per side
        const uint16_t middle_row   = height / 2;         // row 1

        // ── Determine which phase we are in based on elapsed time ────────
        //  Phase layout:  [sweep0] [pause] [sweep1] [pause] [sweep2]
        const uint32_t phase_block = sweep_ms_ + pause_ms_;

        if (elapsed_ms < sweep_ms_) {
            // Phase 1: middle row, center → edges, 50 %
            phase_ = 1;
        } else if (elapsed_ms < phase_block) {
            // Pause after phase 1 — hold phase 1 final frame
            phase_ = 1;
            elapsed_ms = sweep_ms_;  // clamp to end
        } else if (elapsed_ms < phase_block + sweep_ms_) {
            // Phase 2: all rows, edges → center, 50 %
            phase_ = 2;
            elapsed_ms -= phase_block;
        } else if (elapsed_ms < 2 * phase_block) {
            // Pause after phase 2 — hold phase 2 final frame
            phase_ = 2;
            elapsed_ms = sweep_ms_;
        } else if (elapsed_ms < 2 * phase_block + sweep_ms_) {
            // Phase 3: all rows, center → edges, 100 %
            phase_ = 3;
            elapsed_ms -= 2 * phase_block;
        } else {
            // Animation complete
            started_ = false;
            return false;
        }

        const float progress = std::min(
            1.0f, static_cast<float>(elapsed_ms) / static_cast<float>(sweep_ms_));
        const uint16_t cols_reached = static_cast<uint16_t>(progress * half_width);

        // Brightness: phases 1-2 = 50 %, phase 3 = 100 %
        const uint8_t phase_bright = (phase_ <= 2) ? 128 : 255;
        const float scale = (static_cast<float>(phase_bright) / 255.0f)
                          * (static_cast<float>(brightness)   / 255.0f);
        const RgbColor lit_color = RgbColor::LinearBlend(
            RgbColor(0, 0, 0), color_, scale);

        // ── Render ───────────────────────────────────────────────────────
        switch (phase_) {
        case 1:
            // Middle row only, sweep from center outward
            render_center_outward(strip, width, height, pixel_index,
                                  center_left, center_right, cols_reached,
                                  lit_color, /*middle_only=*/true, middle_row);
            break;

        case 2:
            // All rows, sweep from edges inward to center
            render_edges_inward(strip, width, height, pixel_index,
                                cols_reached, half_width, lit_color);
            break;

        case 3:
            // All rows, sweep from center outward
            render_center_outward(strip, width, height, pixel_index,
                                  center_left, center_right, cols_reached,
                                  lit_color, /*middle_only=*/false, middle_row);
            break;
        }

        return true;
    }

private:
    RgbColor  color_;
    uint32_t  sweep_ms_;
    uint32_t  pause_ms_;
    bool      started_;
    uint8_t   phase_ = 0;
    bool      clear_on_next_tick_ = false;

    // ── Render helpers ──────────────────────────────────────────────────

    /// Sweep from center columns outward.  `cols_reached` = how many
    /// columns from center have been lit (0 = none, half_width = all).
    void render_center_outward(
            RearStrip* strip,
            uint16_t width, uint16_t height, PixelIndexFn pixel_index,
            uint16_t center_left, uint16_t center_right,
            uint16_t cols_reached, RgbColor lit_color,
            bool middle_only, uint16_t middle_row)
    {
        for (uint16_t col = 0; col < width; ++col) {
            // Distance from nearer center column
            uint16_t dist;
            if (col <= center_left) {
                dist = center_left - col;
            } else if (col >= center_right) {
                dist = col - center_right;
            } else {
                dist = 0;  // one of the two center columns
            }

            if (dist < cols_reached) {
                if (middle_only) {
                    strip->SetPixelColor(pixel_index(col, middle_row), lit_color);
                } else {
                    for (uint16_t row = 0; row < height; ++row) {
                        strip->SetPixelColor(pixel_index(col, row), lit_color);
                    }
                }
            }
        }
    }

    /// Sweep from both edges inward toward center.  `cols_reached` = how
    /// many columns from each edge have been lit.
    void render_edges_inward(
            RearStrip* strip,
            uint16_t width, uint16_t height, PixelIndexFn pixel_index,
            uint16_t cols_reached, uint16_t half_width,
            RgbColor lit_color)
    {
        for (uint16_t col = 0; col < width; ++col) {
            // Distance from nearest edge
            uint16_t dist_from_edge = std::min(col,
                                               static_cast<uint16_t>(width - 1 - col));
            if (dist_from_edge < cols_reached) {
                for (uint16_t row = 0; row < height; ++row) {
                    strip->SetPixelColor(pixel_index(col, row), lit_color);
                }
            }
        }
    }
};
