#pragma once
/// @file settings_store.hpp
/// Keeps the LightsConfig in NVS (namespace "zc_lights", key "cfg") in the blob
/// format of core/lights_config.hpp without the catalog section.
///
/// Writes are debounced: a flash write pauses the cache and can make the LED
/// output stutter, so dragging a slider must not write on every step.
/// Only call from loop().

#include <Arduino.h>
#include <Preferences.h>
#include <core/lights_config.hpp>

class SettingsStore {
public:
    static constexpr uint32_t SAVE_DELAY_MS = 2000;

    /// The stored settings, or the defaults (field by field) when missing or unreadable.
    LightsConfig load() {
        LightsConfig cfg;
        Preferences prefs;
        if (!prefs.begin(NAMESPACE, /*readOnly=*/true)) {
            Serial.println("[settings] no stored settings, using defaults");
            return cfg;
        }
        uint8_t buf[LIGHTS_CONFIG_MAX_SIZE];
        const size_t n = prefs.getBytes(KEY, buf, sizeof buf);
        prefs.end();
        if (n == 0 || !decode_config(buf, n, cfg)) {
            Serial.println("[settings] stored settings unreadable, using defaults");
            return LightsConfig{};
        }
        Serial.printf("[settings] loaded: welcome %s, front %u, rear %u, ambient %u\n",
                      cfg.welcome_enabled ? "on" : "off", cfg.front_id, cfg.rear_id, cfg.ambient);
        return cfg;
    }

    /// Schedules a save of `cfg` SAVE_DELAY_MS after the last change.
    void request_save(const LightsConfig& cfg, uint32_t now) {
        pending_     = cfg;
        has_pending_ = true;
        due_ms_      = now + SAVE_DELAY_MS;
    }

    void tick(uint32_t now) {
        if (!has_pending_ || static_cast<int32_t>(now - due_ms_) < 0) return;
        has_pending_ = false;

        uint8_t buf[LIGHTS_CONFIG_MAX_SIZE];
        const size_t n = encode_config(pending_, buf, sizeof buf, /*with_catalog=*/false);
        Preferences prefs;
        if (n == 0 || !prefs.begin(NAMESPACE, /*readOnly=*/false)) {
            Serial.println("[settings] save failed");
            return;
        }
        const size_t written = prefs.putBytes(KEY, buf, n);
        prefs.end();
        Serial.printf("[settings] saved (%u bytes)\n", static_cast<unsigned>(written));
    }

private:
    static constexpr const char* NAMESPACE = "zc_lights";
    static constexpr const char* KEY       = "cfg";

    LightsConfig pending_;
    bool         has_pending_ = false;
    uint32_t     due_ms_      = 0;
};
