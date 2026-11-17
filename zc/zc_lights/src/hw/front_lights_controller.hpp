#pragma once
/// @file front_lights_controller.hpp
/// Renders both front DRL strips from the LightsModel in one FreeRTOS task.
/// The welcome animation is rendered once per frame and shown on both sides,
/// so left and right can never drift apart.
///
/// Each side is one logical 15 px strip (upper and lower strip in parallel),
/// logical index 0 = inner end. Set *_REVERSED if a side is wired from the
/// outer end.

#include <Arduino.h>
#include <NeoPixelBus.h>
#include <animations/registry.hpp>
#include <core/compositor.hpp>
#include <hw/lights_model.hpp>

template <typename LeftMethod, typename RightMethod>
class FrontLightsController {
public:
    static constexpr bool LEFT_REVERSED  = false;
    static constexpr bool RIGHT_REVERSED = false;

    FrontLightsController(LightsModel& model, uint8_t left_pin, uint8_t right_pin)
        : model_(model), left_(N, left_pin), right_(N, right_pin) {}

    void begin() {
        left_.Begin();
        right_.Begin();
        left_.ClearTo(RgbColor(0));
        right_.ClearTo(RgbColor(0));
        left_.Show();
        right_.Show();
        xTaskCreate(task, "front_lights", /*stack=*/4096, this, /*priority=*/2, &task_);
    }

    TaskHandle_t task_handle() const { return task_; }

private:
    static constexpr uint16_t N        = FrontLayout::NUM_LEDS;
    static constexpr uint32_t FRAME_MS = 20;

    // The front strips take G, R, B bytes; NeoGrbFeature makes RgbColor true colours.
    using LeftStrip  = NeoPixelBus<NeoGrbFeature, LeftMethod>;
    using RightStrip = NeoPixelBus<NeoGrbFeature, RightMethod>;

    LightsModel& model_;
    LeftStrip    left_;
    RightStrip   right_;
    TaskHandle_t task_ = nullptr;

    uint8_t welcome_px_[N] = {};
    Rgb8    frame_[N]      = {};

    template <typename Strip>
    static void write(Strip& strip, const Rgb8* frame, bool reversed) {
        for (uint16_t i = 0; i < N; ++i) {
            const Rgb8& c = frame[i];
            strip.SetPixelColor(reversed ? N - 1 - i : i, RgbColor(c.r, c.g, c.b));
        }
    }

    void render_frame(const LightsModel::Snapshot& s, uint32_t now) {
        const LayerSample ls = sample_front(s.welcome, now);
        Canvas1D welcome{welcome_px_, N};
        if (ls.draws()) {
            if (const FrontAnimation* a = anim::find_front(s.welcome.front_id)) a->render(ls.local_t, welcome);
        }

        compose_front({s.drl, blinks_left(s.turn), s.turn_epoch_ms}, ls, welcome, s.welcome.front_color,
                      s.welcome.ambient, now, frame_, N);
        write(left_, frame_, LEFT_REVERSED);

        compose_front({s.drl, blinks_right(s.turn), s.turn_epoch_ms}, ls, welcome, s.welcome.front_color,
                      s.welcome.ambient, now, frame_, N);
        write(right_, frame_, RIGHT_REVERSED);

        left_.Show();
        right_.Show();
    }

    static void task(void* arg) {
        auto* self = static_cast<FrontLightsController*>(arg);
        for (;;) {
            const uint32_t now = millis();
            const LightsModel::Snapshot s = self->model_.snapshot();
            self->render_frame(s, now);

            const bool animating = welcome_active(s.welcome, now) || s.turn != BlinkerState::OFF;
            xTaskNotifyWait(0, ULONG_MAX, nullptr, animating ? pdMS_TO_TICKS(FRAME_MS) : portMAX_DELAY);
        }
    }
};
