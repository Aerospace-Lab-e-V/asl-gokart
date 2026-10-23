#pragma once
/// @file config.hpp
/// ESP32-tuned Sero configuration.
/// Conservative limits to keep RAM usage bounded (~10-15 KB).

#include <cstddef>
#include <cstdint>
#include <sero/core/log.hpp>
#include <NeoPixelBus.h>

/// Unified enum for turn signal / hazard states.
enum class BlinkerState : uint8_t {
    OFF = 0,
    LEFT = 1,
    RIGHT = 2,
    HAZARD = 3
};

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

    // ── Method IDs (bit 15 = 0, range 0x0000–0x7FFF) ───────────
    static constexpr uint16_t ZC_LIGHTS_LEFT_ID              = 0x0002;  // Toggle left turn signal
    static constexpr uint16_t ZC_LIGHTS_RIGHT_ID             = 0x0003;  // Toggle right turn signal
    static constexpr uint16_t ZC_LIGHTS_HAZARD_ID            = 0x0004;  // Toggle hazard lights
    static constexpr uint16_t ZC_LIGHTS_HIGH_BEAMS_ID        = 0x0006;  // Toggle high beams (relay)
    static constexpr uint16_t ZC_LIGHTS_BRAKE_ID             = 0x0007;  // Toggle brake light
    static constexpr uint16_t ZC_LIGHTS_REVERSE_ID           = 0x0008;  // Toggle reverse light
    static constexpr uint16_t ZC_LIGHTS_DRL_ID               = 0x0009;  // Toggle front DRLs on/off
    static constexpr uint16_t ZC_LIGHTS_WELCOME_ID           = 0x000A;  // Trigger welcome light animation
    static constexpr uint16_t ZC_LIGHTS_SET_BRIGHTNESS_ID    = 0x000B;  // Set brightness [target, value]
    static constexpr uint16_t ZC_LIGHTS_SET_WELCOME_COLOR_ID = 0x000C;  // Set welcome color [R, G, B]
    static constexpr uint16_t ZC_LIGHTS_TAIL_ID              = 0x000D;  // Toggle rear tail light

    // Reserved OTA trigger method (present on every ZC, bit 15 = 0).
    // Payload: UTF-8 URL string of the firmware binary served by the headunit.
    static constexpr uint16_t ZC_LIGHTS_OTA_METHOD_ID        = 0x00FF;

    // ── Event IDs (bit 15 = 1, range 0x8000–0xFFFF) ────────────
    static constexpr uint16_t ZC_LIGHTS_EVENT_TURN_STATE_ID    = 0x8001;  // Turn signal state [left, right]
    static constexpr uint16_t ZC_LIGHTS_EVENT_HIGH_BEAM_STATE_ID = 0x8003;  // High beam state [left, right]
    static constexpr uint16_t ZC_LIGHTS_EVENT_BRAKE_STATE_ID   = 0x8004;  // Brake state [on]
    static constexpr uint16_t ZC_LIGHTS_EVENT_REVERSE_STATE_ID = 0x8005;  // Reverse state [on]
    static constexpr uint16_t ZC_LIGHTS_EVENT_DRL_STATE_ID     = 0x8006;  // DRL state [on]
    static constexpr uint16_t ZC_LIGHTS_EVENT_TAIL_STATE_ID    = 0x8007;  // Tail state [on]
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

// ── Rear Light Bar Configuration ────────────────────────────────
//
//  Zone layout (per row of 144 columns):
//  ┌─────────────┬───────┬──────────┬───────┬─────────────┐
//  │ TURN LEFT   │ REV L │  BRAKE   │ REV R │ TURN RIGHT  │
//  │ cols  0–35  │ 36–53 │  54–89   │ 90–107│ cols 108–143│
//  └─────────────┴───────┴──────────┴───────┴─────────────┘
//
struct RearLightBarConfig {
    // Matrix dimensions
    static constexpr uint16_t WIDTH    = 144;
    static constexpr uint16_t HEIGHT   = 3;
    static constexpr uint16_t NUM_LEDS = WIDTH * HEIGHT; // 432

    // ── Zone boundaries (column indices) ────────────────────────
    // Turn signal zones: 36 columns from each end
    static constexpr uint16_t TURN_SIGNAL_WIDTH = 36;

    // Derived zone boundaries
    static constexpr uint16_t TURN_LEFT_START  = 0;
    static constexpr uint16_t TURN_LEFT_END    = TURN_SIGNAL_WIDTH;             // 36 (exclusive)
    static constexpr uint16_t TURN_RIGHT_START = WIDTH - TURN_SIGNAL_WIDTH;     // 108
    static constexpr uint16_t TURN_RIGHT_END   = WIDTH;                         // 144 (exclusive)

    // Center zone = cols 36–107 (72 columns)
    static constexpr uint16_t CENTER_START = TURN_LEFT_END;                     // 36
    static constexpr uint16_t CENTER_END   = TURN_RIGHT_START;                  // 108

    // Reverse zones: 18 columns inside center, bordering turn zones
    static constexpr uint16_t REVERSE_ZONE_WIDTH = 18;
    static constexpr uint16_t REVERSE_LEFT_START  = CENTER_START;               // 36
    static constexpr uint16_t REVERSE_LEFT_END    = CENTER_START + REVERSE_ZONE_WIDTH; // 54
    static constexpr uint16_t REVERSE_RIGHT_START = CENTER_END - REVERSE_ZONE_WIDTH;   // 90
    static constexpr uint16_t REVERSE_RIGHT_END   = CENTER_END;                // 108

    // Brake zone: between reverse zones (cols 54–89, 36 columns)
    static constexpr uint16_t BRAKE_START = REVERSE_LEFT_END;                   // 54
    static constexpr uint16_t BRAKE_END   = REVERSE_RIGHT_START;                // 90

    // ── Sweep animation settings ────────────────────────────────
    static constexpr uint32_t BLINK_SWEEP_DURATION_MS = 400;
    static constexpr uint32_t BLINK_OFF_DURATION_MS   = 300;

    // ── Brightness defaults (0–255) ─────────────────────────────
    static constexpr uint8_t BRIGHTNESS_TAIL    = 80;
    static constexpr uint8_t BRIGHTNESS_BRAKE   = 255;
    static constexpr uint8_t BRIGHTNESS_REVERSE = 200;
    static constexpr uint8_t BRIGHTNESS_TURN    = 255;

    // ── Colors ──────────────────────────────────────────────────
    inline static const RgbColor COLOR_OFF     = RgbColor(  0,   0,   0);
    inline static const RgbColor COLOR_TAIL    = RgbColor(255,   0,   0);
    inline static const RgbColor COLOR_BRAKE   = RgbColor(255,   0,   0);
    inline static const RgbColor COLOR_TURN    = RgbColor(255,  40,   0);
    inline static const RgbColor COLOR_REVERSE = RgbColor(255, 255, 255);
};

// ── Welcome Animation Configuration (shared by DRL + rear bar) ──
struct WelcomeConfig {
    // Shared default welcome color (both DRL glow and rear sweep)
    inline static const RgbColor COLOR_DEFAULT = RgbColor(  0, 100, 255);  // blue

    // ── Rear welcome animation phase durations ──────────────────
    static constexpr uint32_t REAR_PHASE_SWEEP_MS = 800;   // per sweep phase
    static constexpr uint32_t REAR_PHASE_PAUSE_MS = 0;   // pause between phases

    // ── DRL welcome glow duration ───────────────────────────────
    static constexpr uint32_t DRL_GLOW_DURATION_MS = 3000;
};

// ── Front DRL Strip Configuration ───────────────────────────────
struct FrontDrlConfig {
    // Strip dimensions (1D)
    static constexpr uint16_t NUM_LEDS = 15;

    // ── Animation timing ────────────────────────────────────────
    static constexpr uint32_t BLINK_SWEEP_DURATION_MS  = 400;
    static constexpr uint32_t BLINK_OFF_DURATION_MS    = 300;
    static constexpr uint32_t WELCOME_GLOW_DURATION_MS = WelcomeConfig::DRL_GLOW_DURATION_MS;

    // ── Brightness defaults ─────────────────────────────────────
    static constexpr uint8_t BRIGHTNESS_DRL  = 128;
    static constexpr uint8_t BRIGHTNESS_TURN = 128;

    // ── Colors ──────────────────────────────────────────────────
    inline static const RgbColor COLOR_OFF     = RgbColor(  0,   0,   0);
    inline static const RgbColor COLOR_DRL     = RgbColor(255, 255, 255);
    inline static const RgbColor COLOR_TURN    = RgbColor(255,  40,   0);
    inline static const RgbColor COLOR_WELCOME = WelcomeConfig::COLOR_DEFAULT;
};
