#pragma once
/// @file types.hpp
/// Core enumerations, type aliases, and helpers for Sero (§2).

#include <array>
#include <cstddef>
#include <cstdint>

namespace sero {

// ──────────────────────── Protocol constants ────────────────────────

static constexpr uint8_t  PROTOCOL_VERSION   = 0x01;
static constexpr uint16_t SD_SERVICE_ID      = 0xFFFF;
static constexpr uint16_t DIAG_SERVICE_ID    = 0xFFFE;
static constexpr uint16_t CLIENT_ID_PROVIDER = 0x0000;
static constexpr uint32_t REQUEST_ID_NONE    = 0x00000000;
static constexpr std::size_t HEADER_SIZE     = 20;
static constexpr std::size_t CRC_SIZE        = 2;
static constexpr std::size_t HMAC_SIZE       = 16;
static constexpr std::size_t MIN_MESSAGE_SIZE = HEADER_SIZE + CRC_SIZE; // 22

// ──────────────────────── Address type ──────────────────────────────

/// Transport address, templated on Config::TransportAddressSize.
template <typename Config>
using Address = std::array<uint8_t, Config::TransportAddressSize>;

// ──────────────────────── Message Type (§2.3) ──────────────────────

enum class MessageType : uint8_t {
    REQUEST            = 0x00,
    REQUEST_NO_RETURN  = 0x01,
    RESPONSE           = 0x02,
    NOTIFICATION       = 0x03,
    ERROR              = 0x80,
};

/// Returns true for known (valid) message types.
constexpr bool is_valid_message_type(uint8_t v) {
    return v == 0x00 || v == 0x01 || v == 0x02 || v == 0x03 || v == 0x80;
}

// ──────────────────────── Return Code (§2.4) ──────────────────────

enum class ReturnCode : uint8_t {
    E_OK                = 0x00,
    E_NOT_OK            = 0x01,
    E_UNKNOWN_SERVICE   = 0x02,
    E_UNKNOWN_METHOD    = 0x03,
    E_NOT_READY         = 0x04,
    E_NOT_REACHABLE     = 0x05,
    E_TIMEOUT           = 0x06, // local only — never on wire
    E_MALFORMED_MESSAGE = 0x07,
    E_AUTH_FAILED       = 0x08, // local only — never on wire
    E_DUPLICATE         = 0x09, // local only
};

// ──────────────────────── SD Method IDs (§4.2) ─────────────────────

enum class SdMethod : uint16_t {
    SD_OFFER_SERVICE    = 0x0001,
    SD_FIND_SERVICE     = 0x0002,
    SD_SUBSCRIBE_EVENT  = 0x0003,
    SD_SUBSCRIBE_ACK    = 0x0004,
    SD_UNSUBSCRIBE      = 0x0005,
};

// ──────────────────────── Diagnostic Counter (§9.1) ────────────────

enum class DiagnosticCounter : uint8_t {
    CrcErrors            = 0,
    VersionMismatches    = 1,
    OversizedPayloads    = 2,
    TypeIdMismatches     = 3,
    DuplicateMessages    = 4,
    StaleMessages        = 5,
    AuthFailures         = 6,
    UnknownMessageTypes  = 7,
    DroppedMessages      = 8,
    _Count               = 9,
};

// ──────────────────────── DTC Severity (§10.1) ─────────────────────

enum class DtcSeverity : uint8_t {
    Info    = 0,
    Warning = 1,
    Error   = 2,
    Fatal   = 3,
};

// ──────────────────────── Diagnostics Method IDs (§10.2) ───────────

enum class DiagMethod : uint16_t {
    DIAG_GET_DTCS        = 0x0001,
    DIAG_CLEAR_DTCS      = 0x0002,
    DIAG_GET_COUNTERS    = 0x0003,
    DIAG_GET_SERVICE_LIST = 0x0004,
    DIAG_GET_DEVICE_INFO = 0x0005,
};

// ──────────────────────── Flags ────────────────────────────────────

static constexpr uint8_t FLAG_AUTH = 0x01; // bit 0

// ──────────────────────── Helper free functions ────────────────────

/// Event IDs have bit 15 set (§2.2).
constexpr bool is_event_id(uint16_t id) { return (id & 0x8000) != 0; }

/// Method IDs have bit 15 clear (§2.2).
constexpr bool is_method_id(uint16_t id) { return (id & 0x8000) == 0; }

/// Per §2.5 — check that bit 15 of method/event ID matches the message type.
constexpr bool type_id_consistent(MessageType mt, uint16_t method_event_id) {
    switch (mt) {
        case MessageType::REQUEST:
        case MessageType::REQUEST_NO_RETURN:
        case MessageType::RESPONSE:
        case MessageType::ERROR:
            return is_method_id(method_event_id);
        case MessageType::NOTIFICATION:
            return is_event_id(method_event_id);
        default:
            return false;
    }
}

} // namespace sero
