#pragma once
/// @file lights_model.hpp
/// The one owner of the requested light state, the running welcome and the
/// user settings. Sero handlers and the zc_motor consumer write it; the front
/// and rear render tasks take a snapshot every frame.
///
/// Safety rule: brake, reverse, a turn signal or the kart moving cancel a
/// running welcome. A cancelled welcome is dropped, it never restarts.

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <core/light_layout.hpp>
#include <core/lights_config.hpp>
#include <core/welcome_plan.hpp>
#include <hw/event_outbox.hpp>

class LightsModel {
public:
    struct Snapshot {
        bool         drl = false, tail = false, brake = false, reverse = false;
        BlinkerState turn = BlinkerState::OFF;
        uint32_t     turn_epoch_ms = 0;
        uint8_t      physical_left = 0, physical_right = 0;
        bool         moving = false;
        WelcomePlan  welcome;
        LightsConfig cfg;
    };

    enum class PlayResult : uint8_t { Started, RefusedSafety, RefusedMoving };

    explicit LightsModel(EventOutbox& outbox) : outbox_(outbox), mutex_(xSemaphoreCreateMutex()) {}

    void init(const LightsConfig& cfg) {
        Lock l(mutex_);
        s_.cfg = cfg;
    }

    void attach_tasks(TaskHandle_t front, TaskHandle_t rear) {
        front_task_ = front;
        rear_task_  = rear;
    }

    Snapshot snapshot() const {
        Lock l(mutex_);
        return s_;
    }

    // ── Lights ───────────────────────────────────────────────────────────────

    void set_drl(bool on)  { set_flag(s_.drl, on, EV_DRL, false); }
    void set_tail(bool on) { set_flag(s_.tail, on, EV_TAIL, false); }
    void set_brake(bool on) { set_flag(s_.brake, on, EV_BRAKE, on); }
    void set_reverse(bool on) { set_flag(s_.reverse, on, EV_REVERSE, on); }

    bool drl() const { Lock l(mutex_); return s_.drl; }
    bool tail() const { Lock l(mutex_); return s_.tail; }
    bool brake() const { Lock l(mutex_); return s_.brake; }
    bool reverse() const { Lock l(mutex_); return s_.reverse; }

    /// Indicator state machine: hazard overrides, left/right are ignored during hazard.
    void toggle_left()   { toggle_turn(BlinkerState::LEFT); }
    void toggle_right()  { toggle_turn(BlinkerState::RIGHT); }
    void toggle_hazard() { toggle_turn(BlinkerState::HAZARD); }

    /// Called by the rear task on each blink edge; becomes the TURN event.
    void set_physical_turn(uint8_t left, uint8_t right) {
        bool changed;
        {
            Lock l(mutex_);
            changed = left != s_.physical_left || right != s_.physical_right;
            s_.physical_left  = left;
            s_.physical_right = right;
        }
        if (changed) outbox_.mark(EV_TURN);
    }

    /// From the zc_motor telemetry; moving cancels the welcome.
    void set_moving(bool moving, uint32_t now) {
        {
            Lock l(mutex_);
            if (s_.moving == moving) return;
            s_.moving = moving;
            if (moving) cancel_locked(now);
        }
        notify();
    }

    // ── Welcome ──────────────────────────────────────────────────────────────

    /// Starts the welcome with the stored settings. `at_boot` skips the moving check
    /// (zc_motor is not known yet at power-up).
    PlayResult play_welcome(uint32_t now, bool at_boot) {
        {
            Lock l(mutex_);
            if (s_.brake || s_.reverse || s_.turn != BlinkerState::OFF) return PlayResult::RefusedSafety;
            if (s_.moving && !at_boot) return PlayResult::RefusedMoving;

            const FrontAnimation* f = anim::find_front(s_.cfg.front_id);
            const RearAnimation*  r = anim::find_rear(s_.cfg.rear_id);
            if (!f || !r) return PlayResult::RefusedSafety;

            WelcomePlan p;
            p.armed       = true;
            p.t0_ms       = now + WelcomeTiming::START_LEAD_MS;
            p.front_id    = f->id;
            p.rear_id     = r->id;
            p.front_dur   = f->duration_ms;
            p.front_cue   = f->cue_ms;
            p.rear_dur    = r->duration_ms;
            p.front_color = s_.cfg.front_color();
            p.rear_color  = s_.cfg.rear_color();
            p.ambient     = s_.cfg.ambient;
            s_.welcome    = p;
        }
        notify();
        return PlayResult::Started;
    }

    /// Clears a finished welcome; true when it was just cleared.
    bool finish_welcome_if_done(uint32_t now) {
        Lock l(mutex_);
        if (!s_.welcome.armed || welcome_active(s_.welcome, now)) return false;
        s_.welcome.armed = false;
        return true;
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    /// mask: b0 enabled, b1 front, b2 rear, b3 ambient. False for mask 0 or unknown ids.
    bool apply_welcome_config(uint8_t mask, bool enabled, uint8_t front_id, uint8_t rear_id, uint8_t ambient) {
        if ((mask & 0x0F) == 0) return false;
        if ((mask & 0x02) && !anim::find_front(front_id)) return false;
        if ((mask & 0x04) && !anim::find_rear(rear_id)) return false;
        {
            Lock l(mutex_);
            if (mask & 0x01) s_.cfg.welcome_enabled = enabled;
            if (mask & 0x02) s_.cfg.front_id = front_id;
            if (mask & 0x04) s_.cfg.rear_id = rear_id;
            if (mask & 0x08) s_.cfg.ambient = ambient;
        }
        outbox_.mark(EV_CONFIG | SAVE_CONFIG);
        return true;
    }

    bool set_anim_color(AnimLayer layer, uint8_t id, Rgb8 c) {
        bool ok;
        {
            Lock l(mutex_);
            ok = s_.cfg.set_color(layer, id, c);
        }
        if (ok) outbox_.mark(EV_CONFIG | SAVE_CONFIG);
        return ok;
    }

    LightsConfig config() const {
        Lock l(mutex_);
        return s_.cfg;
    }

private:
    /// RAII mutex guard.
    struct Lock {
        explicit Lock(SemaphoreHandle_t m) : m_(m) { xSemaphoreTake(m_, portMAX_DELAY); }
        ~Lock() { xSemaphoreGive(m_); }
        SemaphoreHandle_t m_;
    };

    EventOutbox&      outbox_;
    SemaphoreHandle_t mutex_;
    Snapshot          s_;
    TaskHandle_t      front_task_ = nullptr;
    TaskHandle_t      rear_task_  = nullptr;

    void notify() const {
        if (front_task_) xTaskNotify(front_task_, 0, eNoAction);
        if (rear_task_) xTaskNotify(rear_task_, 0, eNoAction);
    }

    void cancel_locked(uint32_t now) {
        if (s_.welcome.armed && !s_.welcome.cancelled) {
            s_.welcome.cancelled = true;
            s_.welcome.cancel_ms = now;
        }
    }

    void set_flag(bool& field, bool on, EventBit bit, bool cancels_welcome) {
        {
            Lock l(mutex_);
            if (field == on) return;
            field = on;
            if (cancels_welcome) cancel_locked(millis());
        }
        outbox_.mark(bit);
        notify();
    }

    void toggle_turn(BlinkerState pressed) {
        {
            Lock l(mutex_);
            const BlinkerState cur = s_.turn;
            if (pressed != BlinkerState::HAZARD && cur == BlinkerState::HAZARD) {
                Serial.println("[lights] turn ignored — hazard active");
                return;
            }
            const BlinkerState next = (cur == pressed) ? BlinkerState::OFF : pressed;
            s_.turn = next;
            s_.turn_epoch_ms = millis();
            if (next != BlinkerState::OFF) cancel_locked(s_.turn_epoch_ms);
            Serial.printf("[lights] turn → %u\n", static_cast<unsigned>(next));
        }
        notify();
    }
};
