#pragma once
/// @file rear_light_bar_controller.hpp
/// Renders the rear 144 × 3 bar from the LightsModel in its own FreeRTOS task.
/// Composition (tail, welcome, brake, reverse, turn) is in core/compositor.hpp;
/// this file only maps the logical frame to the serpentine wiring and reports
/// the physical blink state.

#include <Arduino.h>
#include <NeoPixelBus.h>
#include <animations/registry.hpp>
#include <core/compositor.hpp>
#include <hw/lights_model.hpp>

class RearLightBarController {
public:
    explicit RearLightBarController(LightsModel& model, uint8_t pin) : model_(model), strip_(L::NUM_LEDS, pin) {}

    void begin() {
        strip_.Begin();
        strip_.ClearTo(RgbColor(0));
        strip_.Show();
        xTaskCreate(task, "rear_bar", /*stack=*/8192, this, /*priority=*/2, &task_);
    }

    TaskHandle_t task_handle() const { return task_; }

private:
    using L = RearLayout;
    static constexpr uint32_t FRAME_MS = 20;
    /// Odd rows are wired right-to-left.
    static constexpr bool ZIGZAG = true;

    /// The rear LEDs take R, G, B bytes, unlike the front strips.
    using Strip = NeoPixelBus<NeoRgbFeature, NeoEsp32Rmt0Ws2812xMethod>;

    LightsModel& model_;
    Strip        strip_;
    TaskHandle_t task_ = nullptr;

    uint8_t welcome_px_[L::NUM_LEDS] = {};
    Rgb8    frame_[L::NUM_LEDS]      = {};

    static uint16_t physical_index(uint16_t col, uint16_t row) {
        if (ZIGZAG && (row & 1)) return row * L::WIDTH + (L::WIDTH - 1 - col);
        return row * L::WIDTH + col;
    }

    void render_frame(const LightsModel::Snapshot& s, uint32_t now) {
        const LayerSample ls = sample_rear(s.welcome, now);
        Canvas2D welcome{welcome_px_, L::WIDTH, L::HEIGHT};
        if (ls.draws()) {
            if (const RearAnimation* a = anim::find_rear(s.welcome.rear_id)) a->render(ls.local_t, welcome);
        }

        compose_rear({s.tail, s.brake, s.reverse, s.turn, s.turn_epoch_ms}, ls, welcome, s.welcome.rear_color,
                     s.welcome.ambient, now, frame_);

        for (uint16_t row = 0; row < L::HEIGHT; ++row) {
            for (uint16_t col = 0; col < L::WIDTH; ++col) {
                const Rgb8& c = frame_[row * L::WIDTH + col];
                strip_.SetPixelColor(physical_index(col, row), RgbColor(c.r, c.g, c.b));
            }
        }
        strip_.Show();

        // Physical blink state for the headunit's indicator lamps.
        const bool lit = s.turn != BlinkerState::OFF && blink_at(now, s.turn_epoch_ms).lit;
        model_.set_physical_turn(lit && blinks_left(s.turn) ? 1 : 0, lit && blinks_right(s.turn) ? 1 : 0);
    }

    static void task(void* arg) {
        auto* self = static_cast<RearLightBarController*>(arg);
        for (;;) {
            const uint32_t now = millis();
            const LightsModel::Snapshot s = self->model_.snapshot();
            self->render_frame(s, now);

            const bool animating = welcome_active(s.welcome, now) || s.turn != BlinkerState::OFF;
            xTaskNotifyWait(0, ULONG_MAX, nullptr, animating ? pdMS_TO_TICKS(FRAME_MS) : portMAX_DELAY);
        }
    }
};
