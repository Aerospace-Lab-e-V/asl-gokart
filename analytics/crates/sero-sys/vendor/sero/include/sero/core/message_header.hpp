#pragma once
/// @file message_header.hpp
/// 20-byte Sero message header serialize / deserialize (§2.2).

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "sero/core/types.hpp"

namespace sero {

struct MessageHeader {
    uint8_t     version          = PROTOCOL_VERSION;
    uint8_t     message_type     = 0;
    uint8_t     return_code      = 0;
    uint8_t     flags            = 0;
    uint16_t    service_id       = 0;
    uint16_t    method_event_id  = 0;
    uint16_t    client_id        = 0;
    uint8_t     sequence_counter = 0;
    uint8_t     reserved         = 0;
    uint32_t    request_id       = 0;
    uint32_t    payload_length   = 0;

    static constexpr std::size_t SIZE = HEADER_SIZE; // 20

    // ── Big-endian helpers ──────────────────────────────────────

    static uint16_t read_u16(const uint8_t* p) {
        return static_cast<uint16_t>((p[0] << 8) | p[1]);
    }
    static uint32_t read_u32(const uint8_t* p) {
        return (static_cast<uint32_t>(p[0]) << 24) |
               (static_cast<uint32_t>(p[1]) << 16) |
               (static_cast<uint32_t>(p[2]) <<  8) |
               (static_cast<uint32_t>(p[3]));
    }
    static void write_u16(uint8_t* p, uint16_t v) {
        p[0] = static_cast<uint8_t>(v >> 8);
        p[1] = static_cast<uint8_t>(v);
    }
    static void write_u32(uint8_t* p, uint32_t v) {
        p[0] = static_cast<uint8_t>(v >> 24);
        p[1] = static_cast<uint8_t>(v >> 16);
        p[2] = static_cast<uint8_t>(v >>  8);
        p[3] = static_cast<uint8_t>(v);
    }

    // ── Deserialize from raw 20 bytes ──────────────────────────

    static MessageHeader deserialize(const uint8_t* data) {
        MessageHeader h;
        h.version          = data[0];
        h.message_type     = data[1];
        h.return_code      = data[2];
        h.flags            = data[3];
        h.service_id       = read_u16(data + 4);
        h.method_event_id  = read_u16(data + 6);
        h.client_id        = read_u16(data + 8);
        h.sequence_counter = data[10];
        h.reserved         = data[11];
        h.request_id       = read_u32(data + 12);
        h.payload_length   = read_u32(data + 16);
        return h;
    }

    // ── Serialize into raw 20 bytes ────────────────────────────

    void serialize(uint8_t* out) const {
        out[0]  = version;
        out[1]  = message_type;
        out[2]  = return_code;
        out[3]  = flags;
        write_u16(out + 4,  service_id);
        write_u16(out + 6,  method_event_id);
        write_u16(out + 8,  client_id);
        out[10] = sequence_counter;
        out[11] = reserved;
        write_u32(out + 12, request_id);
        write_u32(out + 16, payload_length);
    }

    // ── Validation helpers (§2.5, §2.6) ────────────────────────

    /// Check bit-15 consistency between message type and method/event ID.
    bool validate_type_id_consistency() const {
        return type_id_consistent(static_cast<MessageType>(message_type),
                                  method_event_id);
    }

    /// §2.6 — discard REQUEST / REQUEST_NO_RETURN with client_id == 0.
    bool validate_client_id() const {
        auto mt = static_cast<MessageType>(message_type);
        if ((mt == MessageType::REQUEST || mt == MessageType::REQUEST_NO_RETURN)
            && client_id == 0x0000) {
            return false;
        }
        return true;
    }

    /// Returns true when the AUTH flag (bit 0) is set.
    bool has_auth() const { return (flags & FLAG_AUTH) != 0; }
};

} // namespace sero
