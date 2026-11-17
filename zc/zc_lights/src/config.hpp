#pragma once
/// @file config.hpp
/// ESP32-tuned Sero configuration.
/// Conservative limits to keep RAM usage bounded (~10-15 KB).

#include <cstddef>
#include <cstdint>
#include <sero/core/log.hpp>
#include <Arduino.h>

struct Esp32Config {
    static constexpr std::size_t MaxPayloadSize         = 512;
    static constexpr std::size_t MaxServices            = 4;
    static constexpr std::size_t MaxMethods             = 16;
    static constexpr std::size_t MaxEvents              = 8;
    static constexpr std::size_t MaxSubscribers          = 4;
    static constexpr std::size_t MaxPendingRequests      = 8;
    static constexpr std::size_t MaxKnownServices        = 8;
    static constexpr uint32_t    RequestTimeoutMs        = 2000;
    static constexpr uint16_t    OfferTtlSeconds         = 10;
    static constexpr uint16_t    SubscriptionTtlSeconds  = 15;
    static constexpr uint8_t     SdFindRetryCount        = 5;
    static constexpr uint32_t    SdFindInitialDelayMs    = 200;
    static constexpr uint8_t     SdFindBackoffMultiplier = 2;
    static constexpr uint32_t    SdFindJitterMs          = 50;
    static constexpr uint8_t     SeqCounterAcceptWindow  = 15;
    static constexpr std::size_t TransportAddressSize    = 8;
    static constexpr std::size_t MaxReceiveQueueSize     = 8;
    static constexpr std::size_t MaxTrackedPeers         = 4;
    static constexpr std::size_t HmacKeySize             = 32;
    static constexpr std::size_t MaxDtcs                 = 8;
    static constexpr sero::LogLevel MinLogLevel           = sero::LogLevel::Off;
};

struct Esp32ServiceConfig {
    static constexpr uint16_t ESP32_UNICAST_PORT     = 30491;

    // ── Service ID ──────────────────────────────────────────────
    static constexpr uint16_t ZC_LIGHTS_ID           = 0x0001;

    // ── Protocol of the lights service ─────────────────────────
    // Mirrored by hand in infotainment/headunit/src/main/adapters/sero.ts and
    // analytics/crates/ecu-sero/src/lib.rs — change all three together.
    //
    // Methods (bit 15 = 0). Light methods toggle with an empty payload and set the
    // state with [on]; zc_buttons relies on the toggle form.
    static constexpr uint16_t ZC_LIGHTS_LEFT_ID              = 0x0002;  // toggle left turn signal
    static constexpr uint16_t ZC_LIGHTS_RIGHT_ID             = 0x0003;  // toggle right turn signal
    static constexpr uint16_t ZC_LIGHTS_HAZARD_ID            = 0x0004;  // toggle hazard lights
    static constexpr uint16_t ZC_LIGHTS_HIGH_BEAMS_ID        = 0x0006;  // [] toggle | [on]
    static constexpr uint16_t ZC_LIGHTS_BRAKE_ID             = 0x0007;  // [] toggle | [on]
    static constexpr uint16_t ZC_LIGHTS_REVERSE_ID           = 0x0008;  // [] toggle | [on]
    static constexpr uint16_t ZC_LIGHTS_DRL_ID               = 0x0009;  // [] toggle | [on]
    static constexpr uint16_t ZC_LIGHTS_WELCOME_ID           = 0x000A;  // play the welcome now; E_NOT_READY when
                                                                        // brake/reverse/turn is on or the kart moves
    // 0x000B (SET_BRIGHTNESS) and 0x000C (SET_WELCOME_COLOR) are retired — never reuse.
    static constexpr uint16_t ZC_LIGHTS_TAIL_ID              = 0x000D;  // [] toggle | [on]
    static constexpr uint16_t ZC_LIGHTS_SET_WELCOME_CONFIG_ID = 0x000E; // [mask, enabled, front_id, rear_id, ambient]
                                                                        // mask: b0 enabled, b1 front, b2 rear, b3 ambient
                                                                        // → response: config blob (core/lights_config.hpp)
    static constexpr uint16_t ZC_LIGHTS_SET_ANIM_COLOR_ID    = 0x000F;  // [layer 0 front | 1 rear, anim_id, r, g, b]
                                                                        // → response: config blob
    static constexpr uint16_t ZC_LIGHTS_GET_CONFIG_ID        = 0x0010;  // [] → response: config blob; also re-sends
                                                                        // every light event (subscriptions carry no
                                                                        // initial value)

    // Reserved OTA trigger method (present on every ZC, bit 15 = 0).
    // Payload: UTF-8 URL string of the firmware binary served by the headunit.
    static constexpr uint16_t ZC_LIGHTS_OTA_METHOD_ID        = 0x00FF;

    // Events (bit 15 = 1), sent on change.
    static constexpr uint16_t ZC_LIGHTS_EVENT_TURN_STATE_ID      = 0x8001;  // [left, right] physical blink state
    static constexpr uint16_t ZC_LIGHTS_EVENT_HIGH_BEAM_STATE_ID = 0x8003;  // [left, right]
    static constexpr uint16_t ZC_LIGHTS_EVENT_BRAKE_STATE_ID     = 0x8004;  // [on]
    static constexpr uint16_t ZC_LIGHTS_EVENT_REVERSE_STATE_ID   = 0x8005;  // [on]
    static constexpr uint16_t ZC_LIGHTS_EVENT_DRL_STATE_ID       = 0x8006;  // [on]
    static constexpr uint16_t ZC_LIGHTS_EVENT_TAIL_STATE_ID      = 0x8007;  // [on]
    static constexpr uint16_t ZC_LIGHTS_EVENT_CONFIG_ID          = 0x8008;  // config blob with catalog
    static constexpr uint16_t ZC_LIGHTS_EVENT_WELCOME_STATE_ID   = 0x8009;  // [playing]

    // ── zc_motor service (consumer side — reverse lights follow the Kelly controllers) ──
    static constexpr uint16_t    ZC_MOTOR_ID                     = 0x0004;
    static constexpr uint16_t    ZC_MOTOR_EVENT_RPM_ID           = 0x8001;
    static constexpr std::size_t ZC_MOTOR_EVENT_RPM_PAYLOAD_SIZE = 19;
    // 1 = both Kelly controllers report reverse over UART, see zc_motor main.cpp
    static constexpr std::size_t ZC_MOTOR_EVENT_REVERSE_INDEX    = 18;
    // Big-endian rpm of the left / right Kelly controller
    static constexpr std::size_t ZC_MOTOR_EVENT_LEFT_RPM_INDEX   = 0;
    static constexpr std::size_t ZC_MOTOR_EVENT_RIGHT_RPM_INDEX  = 8;
    // Above this rpm on either side the kart counts as moving: the welcome is cancelled
    // and cannot be started.
    static constexpr uint16_t    ZC_MOTOR_MOVING_RPM             = 30;
    // zc_motor notifies every 100 ms; without a notification for this long the reverse lights go
    // off and the kart no longer counts as moving
    static constexpr uint32_t    ZC_MOTOR_REVERSE_TIMEOUT_MS     = 1000;
};

// ── Hardware Pin Assignments ────────────────────────────────────
struct Esp32HwConfig {
    // High beam relays (binary on/off)
    static constexpr int LED_PIN_HIGH_BEAM_LEFT  = GPIO_NUM_32;
    static constexpr int LED_PIN_HIGH_BEAM_RIGHT = GPIO_NUM_33;

    // ARGB strip data pins (NeoPixelBus via RMT)
    static constexpr int LED_PIN_ARGB_REAR        = GPIO_NUM_4;
    static constexpr int LED_PIN_ARGB_FRONT_LEFT  = GPIO_NUM_16;
    static constexpr int LED_PIN_ARGB_FRONT_RIGHT = GPIO_NUM_13;
};

// Light geometry, zones, levels and colours: core/light_layout.hpp.
// Welcome animations: animations/registry.hpp.
