#pragma once
/// @file config.hpp
/// Compile-time configuration for Sero (§8).
/// Users provide their own struct with the same static constexpr members
/// and pass it as a template parameter to Runtime.
/// MaxDtcs controls the DTC table size for the built-in diagnostics service.
/// Set to 0 to disable DTC storage (diagnostics service still works but
/// GET_DTCS returns empty).

#include <cstddef>
#include <cstdint>

#include "sero/core/log.hpp"

namespace sero {

struct DefaultConfig {
    static constexpr std::size_t MaxPayloadSize           = 1400;
    static constexpr std::size_t MaxServices               = 16;
    static constexpr std::size_t MaxMethods                = 32;
    static constexpr std::size_t MaxEvents                 = 16;
    static constexpr std::size_t MaxSubscribers            = 8;
    static constexpr std::size_t MaxPendingRequests        = 16;
    static constexpr std::size_t MaxKnownServices          = 32;
    static constexpr uint32_t    RequestTimeoutMs          = 1000;
    static constexpr uint16_t    OfferTtlSeconds           = 5;
    static constexpr uint16_t    SubscriptionTtlSeconds    = 10;
    static constexpr uint8_t     SdFindRetryCount          = 3;
    static constexpr uint32_t    SdFindInitialDelayMs      = 100;
    static constexpr uint8_t     SdFindBackoffMultiplier   = 2;
    static constexpr uint32_t    SdFindJitterMs            = 50;
    static constexpr uint8_t     SeqCounterAcceptWindow    = 15;
    static constexpr std::size_t TransportAddressSize      = 8;
    static constexpr std::size_t MaxReceiveQueueSize       = 16;
    static constexpr std::size_t MaxTrackedPeers           = 32;
    static constexpr std::size_t HmacKeySize               = 32;
    static constexpr std::size_t MaxDtcs                    = 32;
    static constexpr LogLevel      MinLogLevel                = LogLevel::Off;
};

/// Embedded-friendly configuration for resource-constrained MCUs (ESP32, STM32, etc.).
/// sizeof(Runtime) with this config is approximately 3–4 KB.
struct EmbeddedConfig {
    static constexpr std::size_t MaxPayloadSize           = 256;
    static constexpr std::size_t MaxServices               = 4;
    static constexpr std::size_t MaxMethods                = 8;
    static constexpr std::size_t MaxEvents                 = 4;
    static constexpr std::size_t MaxSubscribers            = 4;
    static constexpr std::size_t MaxPendingRequests        = 4;
    static constexpr std::size_t MaxKnownServices          = 8;
    static constexpr uint32_t    RequestTimeoutMs          = 500;
    static constexpr uint16_t    OfferTtlSeconds           = 5;
    static constexpr uint16_t    SubscriptionTtlSeconds    = 10;
    static constexpr uint8_t     SdFindRetryCount          = 3;
    static constexpr uint32_t    SdFindInitialDelayMs      = 100;
    static constexpr uint8_t     SdFindBackoffMultiplier   = 2;
    static constexpr uint32_t    SdFindJitterMs            = 50;
    static constexpr uint8_t     SeqCounterAcceptWindow    = 15;
    static constexpr std::size_t TransportAddressSize      = 8;
    static constexpr std::size_t MaxReceiveQueueSize       = 8;
    static constexpr std::size_t MaxTrackedPeers           = 8;
    static constexpr std::size_t HmacKeySize               = 32;
    static constexpr std::size_t MaxDtcs                    = 8;
    static constexpr LogLevel      MinLogLevel                = LogLevel::Off;
};

} // namespace sero
