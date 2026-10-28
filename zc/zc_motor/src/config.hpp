#pragma once
/// @file config.hpp
/// ESP32-tuned Sero configuration for the template zone controller.
/// Adjust the constants below when creating a real ZC from this template.

#include <cstddef>
#include <cstdint>
#include <sero/core/log.hpp>

// ── Sero compile-time limits ─────────────────────────────────────────────────
// Conservative limits keep RAM usage bounded (~10–15 KB).

struct Esp32Config {
    static constexpr std::size_t MaxPayloadSize          = 512;
    static constexpr std::size_t MaxServices             = 4;
    static constexpr std::size_t MaxMethods              = 8;
    static constexpr std::size_t MaxEvents               = 4;
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
    static constexpr sero::LogLevel MinLogLevel          = sero::LogLevel::Off;
};

// ── Service / method / event IDs ─────────────────────────────────────────────
// Method IDs must have bit 15 = 0 (range 0x0001–0x7FFF).
// Event  IDs must have bit 15 = 1 (range 0x8001–0xFFFF).

struct Esp32ServiceConfig {
    static constexpr uint16_t ESP32_UNICAST_PORT = 30491;

    // Registry: zc_lights=0x0001, zc_buttons=0x0002, zc_battery=0x0003.
    static constexpr uint16_t ZC_MOTOR_ID = 0x0004;

    // Reserved OTA trigger method (present on every ZC, bit 15 = 0).
    // Payload: UTF-8 URL string of the firmware binary served by the headunit.
    static constexpr uint16_t ZC_MOTOR_OTA_METHOD_ID = 0x00FF;

    // Method to toggle individual relays (payload: [relay_idx]).
    static constexpr uint16_t ZC_MOTOR_TOGGLE_RELAY_METHOD_ID = 0x0005;

    // Method to switch individual relays (payload: [relay_idx][on u8]).
    // zc_buttons drives relay 2 (reverse) with it on press/release.
    static constexpr uint16_t ZC_MOTOR_SET_RELAY_METHOD_ID = 0x0006;

    // Event: [Motor L/R] each 8 bytes: [rpm u16 BE][throttle u8][brake_pedal u8][switches bitfield][bat_v u8][mot_temp u8][ctrl_temp u8]
    // And extra: [relay 1 u8][relay 2 u8][reverse u8]
    static constexpr uint16_t    ZC_MOTOR_EVENT_RPM_ID            = 0x8001;
    static constexpr std::size_t ZC_MOTOR_EVENT_RPM_PAYLOAD_SIZE  = 19;
};

// ── Hardware pin assignments ─────────────────────────────────────────────────
// Left controller matches the board's TX1/RX1 macros (pins_arduino.h).
// Right controller intentionally avoids the board's default RX2=GPIO35
// (input-only, reserved for throttle ADC on the separate zc_throttle board).
struct Esp32HwConfig {
    static constexpr uint32_t KELLY_BAUD_RATE       = 19200;
    static constexpr uint32_t KELLY_READ_TIMEOUT_MS = 100;
    static constexpr int8_t   KELLY_LEFT_TX_PIN     = 4;
    static constexpr int8_t   KELLY_LEFT_RX_PIN     = 36;
    static constexpr int8_t   KELLY_RIGHT_TX_PIN    = 32;
    static constexpr int8_t   KELLY_RIGHT_RX_PIN    = 33;
    static constexpr int8_t   RELAY_1_PIN           = 13;
    static constexpr int8_t   RELAY_2_PIN           = 16;
};

// ── Drive limits ─────────────────────────────────────────────────────────────
struct Esp32DriveConfig {
    // Motors drive the wheels directly, so motor rpm is wheel rpm
    // (same value as the headunit's derive.ts).
    static constexpr float WHEEL_CIRCUMFERENCE_M = 1.415f;
    // Relay 2 (reverse) only switches on at or below this speed.
    static constexpr float REVERSE_MAX_SPEED_KMH = 3.0f;
};
