#pragma once
/// @file config.hpp
/// ESP32-tuned Sero configuration.
/// Conservative limits to keep RAM usage bounded (~10-15 KB).

#include <cstddef>
#include <cstdint>
#include <sero/core/log.hpp>

struct Esp32Config {
    static constexpr std::size_t MaxPayloadSize         = 512;
    static constexpr std::size_t MaxServices            = 2;
    static constexpr std::size_t MaxMethods             = 4;
    static constexpr std::size_t MaxEvents              = 2;
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
    static constexpr std::size_t MaxDtcs                 = 4;
    static constexpr sero::LogLevel MinLogLevel           = sero::LogLevel::Off;
};

struct Esp32ServiceConfig {
    static constexpr uint16_t ESP32_UNICAST_PORT        = 30491;

    // zc_lights service (consumer side — buttons call these methods)
    static constexpr uint16_t ZC_LIGHTS_ID              = 0x0001;
    static constexpr uint16_t ZC_LIGHTS_LEFT_ID         = 0x0002;
    static constexpr uint16_t ZC_LIGHTS_RIGHT_ID        = 0x0003;
    static constexpr uint16_t ZC_LIGHTS_HAZARD_ID       = 0x0004;
    static constexpr uint16_t ZC_LIGHTS_DRL_ID          = 0x0009;
    static constexpr uint16_t ZC_LIGHTS_HIGH_BEAMS_ID   = 0x0006;

    // zc_motor service (consumer side — bottom right button drives relay 2 / reverse)
    static constexpr uint16_t ZC_MOTOR_ID               = 0x0004;
    // Payload: [relay_idx][on u8]. zc_motor refuses reverse above 3 km/h.
    static constexpr uint16_t ZC_MOTOR_SET_RELAY_ID     = 0x0006;
    static constexpr uint8_t  ZC_MOTOR_REVERSE_RELAY    = 1; // relay 2

    // zc_buttons own service (provider side — exposes OTA method to headunit)
    static constexpr uint16_t ZC_BUTTONS_ID             = 0x0002;

    // Reserved OTA trigger method present on every ZC (bit 15 = 0).
    // Payload: UTF-8 URL string of the firmware binary served by the headunit.
    static constexpr uint16_t ZC_BUTTONS_OTA_METHOD_ID  = 0x00FF;
};

struct ButtonConfig {
    static constexpr bool INVERT_1 = true; // Top Right
    static constexpr bool INVERT_2 = true; // Top Left
    static constexpr bool INVERT_3 = true;  // Bottom Right
    static constexpr bool INVERT_4 = true;  // Bottom Left
    static constexpr bool INVERT_5 = true;
    static constexpr bool INVERT_6 = true;
};
