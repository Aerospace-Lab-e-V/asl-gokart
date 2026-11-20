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
// TODO: Replace 0x00FF with the real service ID assigned to this ZC.
// Method IDs must have bit 15 = 0 (range 0x0001–0x7FFF).
// Event  IDs must have bit 15 = 1 (range 0x8001–0xFFFF).
//
// Protocol conventions (see zc_lights/src/config.hpp for a full example):
//  - Every consumer mirrors these IDs by hand (headunit src/main/adapters/sero.ts, analytics
//    crates/ecu-sero/src/lib.rs, other ZCs). Change all of them together, and say so in a comment here.
//  - Never reuse the ID of a removed method or event; mark it "retired" instead.
//  - A method that switches something toggles with an empty payload and sets with [value].
//  - Subscriptions carry no initial value. If clients need this ZC's state, add a GET_STATE method that
//    returns it and re-sends every event once, so a client that starts late catches up.

struct Esp32ServiceConfig {
    static constexpr uint16_t ESP32_UNICAST_PORT = 30491;

    // TODO: Assign a unique service ID from the project's ID registry.
    static constexpr uint16_t ZC_TEMPLATE_ID = 0x00FF;

    // Method callable by remote nodes (bit 15 = 0).
    static constexpr uint16_t ZC_TEMPLATE_METHOD_EXAMPLE_ID = 0x0001;

    // Reserved OTA trigger method (present on every ZC, bit 15 = 0).
    // Payload: UTF-8 URL string of the firmware binary served by the headunit.
    static constexpr uint16_t ZC_TEMPLATE_OTA_METHOD_ID = 0x00FF;

    // Event emitted periodically to subscribers (bit 15 = 1).
    static constexpr uint16_t ZC_TEMPLATE_EVENT_EXAMPLE_ID = 0x8001;
};
