#pragma once
/// @file crc16.hpp
/// CRC-16/CCITT-FALSE — polynomial 0x1021, init 0xFFFF, no reflection (§7.1).

#include <cstddef>
#include <cstdint>

namespace sero {
namespace detail {

/// Compile-time CRC-16/CCITT-FALSE lookup table.
struct Crc16Table {
    uint16_t entries[256]{};

    constexpr Crc16Table() {
        for (int i = 0; i < 256; ++i) {
            uint16_t crc = static_cast<uint16_t>(i << 8);
            for (int j = 0; j < 8; ++j) {
                if (crc & 0x8000) {
                    crc = static_cast<uint16_t>((crc << 1) ^ 0x1021);
                } else {
                    crc = static_cast<uint16_t>(crc << 1);
                }
            }
            entries[i] = crc;
        }
    }
};

inline constexpr Crc16Table crc16_table{};

} // namespace detail

/// Compute CRC-16/CCITT-FALSE over [data, data+length).
inline uint16_t crc16_compute(const uint8_t* data, std::size_t length) {
    uint16_t crc = 0xFFFF;
    for (std::size_t i = 0; i < length; ++i) {
        uint8_t idx = static_cast<uint8_t>((crc >> 8) ^ data[i]);
        crc = static_cast<uint16_t>((crc << 8) ^ detail::crc16_table.entries[idx]);
    }
    return crc;
}

/// Append 2-byte big-endian CRC after data_length bytes in buffer.
/// buffer must have room for 2 extra bytes.
inline void crc16_append(uint8_t* buffer, std::size_t data_length) {
    uint16_t crc = crc16_compute(buffer, data_length);
    buffer[data_length]     = static_cast<uint8_t>(crc >> 8);
    buffer[data_length + 1] = static_cast<uint8_t>(crc);
}

/// Verify that the last 2 bytes of [data, data+total_length) are a valid CRC
/// over the preceding bytes.  total_length must be >= 2.
inline bool crc16_verify(const uint8_t* data, std::size_t total_length) {
    if (total_length < 2) return false;
    std::size_t payload_len = total_length - 2;
    uint16_t computed = crc16_compute(data, payload_len);
    uint16_t stored = static_cast<uint16_t>((data[payload_len] << 8) | data[payload_len + 1]);
    return computed == stored;
}

} // namespace sero
