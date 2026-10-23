#pragma once
/// @file kelly_decoder.hpp
/// UART transport + packet decoder for Kelly motor controllers.
/// Ported from rust_impl/uart.rs + rust_impl/kelly_decoder.rs.

#include <Arduino.h>
#include <array>
#include <cstddef>
#include <cstdint>

namespace kelly {

inline constexpr std::size_t PACKET_LENGTH  = 19;
inline constexpr std::size_t CRC_INDEX      = 18;
inline constexpr uint8_t     CMD_PACKET_A   = 0x3A;
inline constexpr uint8_t     CMD_PACKET_B   = 0x3B;

/// Upper bound on bytes discarded while flushing stale RX data before a
/// command. Bounds the loop so a noisy/miswired line can't hang the ZC.
inline constexpr std::size_t FLUSH_MAX_BYTES = 64;

/// Consecutive failed reads of one packet type that keep its last good
/// values (300 ms at the 100 ms poll). A single bad read is common on the
/// UART; zeroing it showed as e.g. a 0 °C blip. Past this the controller
/// counts as gone and reads zero, which the headunit relies on.
inline constexpr uint8_t MAX_HELD_FAILURES = 3;

using Packet = std::array<uint8_t, PACKET_LENGTH>;

enum class PacketType : uint8_t {
    Unknown,
    PacketA,
    PacketB,
};

/// Pedal / switch / hall / temperature telemetry (command 0x3A).
struct PacketA {
    uint8_t command        = 0;
    uint8_t static_var     = 0;
    uint8_t throttle       = 0;
    uint8_t brake_pedal    = 0;
    uint8_t brake_switch   = 0;
    uint8_t foot_switch    = 0;
    uint8_t forward_switch = 0;
    bool    reverse        = false;
    bool    hall_a         = false;
    bool    hall_b         = false;
    bool    hall_c         = false;
    uint8_t battery_voltage = 0;
    uint8_t motor_temp      = 0;
    uint8_t controller_temp = 0;
    bool    setting_dir     = false;
    bool    actual_dir      = false;
};

/// RPM + phase current (command 0x3B). Remaining bytes are unused padding
/// in rust_impl and are not individually named here.
struct PacketB {
    uint16_t rpm           = 0;
    uint16_t phase_current = 0;
};

/// Wrapping byte-sum checksum over bytes[0..CRC_INDEX), matching rust's
/// `fold(0u8, wrapping_add)`.
inline uint8_t calculate_crc(const Packet& bytes) {
    uint8_t sum = 0;
    for (std::size_t i = 0; i < CRC_INDEX; ++i) {
        sum = static_cast<uint8_t>(sum + bytes[i]);
    }
    return sum;
}

inline bool validate_checksum(const Packet& bytes) {
    return calculate_crc(bytes) == bytes[CRC_INDEX];
}

inline PacketType determine_packet_type(const Packet& bytes) {
    switch (bytes[0]) {
        case CMD_PACKET_A: return PacketType::PacketA;
        case CMD_PACKET_B: return PacketType::PacketB;
        default:           return PacketType::Unknown;
    }
}

inline void parse_packet_a(const Packet& bytes, PacketA& out) {
    out.command        = bytes[0];
    out.static_var      = bytes[1];
    out.throttle        = bytes[2];
    out.brake_pedal      = bytes[3];
    out.brake_switch     = bytes[4];
    out.foot_switch      = bytes[5];
    out.forward_switch   = bytes[6];
    out.reverse          = bytes[7] != 0;
    out.hall_a           = bytes[8] != 0;
    out.hall_b           = bytes[9] != 0;
    out.hall_c           = bytes[10] != 0;
    out.battery_voltage  = bytes[11];
    out.motor_temp       = bytes[12];
    out.controller_temp  = bytes[13];
    out.setting_dir      = bytes[14] != 0;
    out.actual_dir       = bytes[15] != 0;
    // bytes[16]/[17] are unused/unknown in rust_impl; bytes[18] is the CRC.
}

inline void parse_packet_b(const Packet& bytes, PacketB& out) {
    out.rpm           = static_cast<uint16_t>((static_cast<uint16_t>(bytes[4]) << 8) | bytes[5]);
    out.phase_current = static_cast<uint16_t>((static_cast<uint16_t>(bytes[6]) << 8) | bytes[7]);
}

} // namespace kelly

/// Polls one Kelly motor controller over a dedicated HardwareSerial port.
/// Non-owning, non-copyable, non-movable — wraps a hardware resource whose
/// lifetime is managed elsewhere (the global Serial1/Serial2 instances).
class KellyController {
public:
    explicit KellyController(HardwareSerial& serial) noexcept : serial_(serial) {}

    KellyController(const KellyController&)            = delete;
    KellyController& operator=(const KellyController&) = delete;
    KellyController(KellyController&&)                 = delete;
    KellyController& operator=(KellyController&&)      = delete;

    /// Configures the UART. Note: HardwareSerial::begin()'s own
    /// `timeout_ms` parameter only governs ESP32's auto-baud-detection
    /// window — it is unrelated to `read_timeout_ms` here, which bounds
    /// readBytes() below via Stream::setTimeout().
    void begin(uint32_t baud_rate, int8_t rx_pin, int8_t tx_pin, uint32_t read_timeout_ms, bool invert = false) {
        serial_.begin(baud_rate, SERIAL_8N1, rx_pin, tx_pin, invert);
        serial_.setTimeout(read_timeout_ms);
    }

    /// Requests + decodes Packet A, then Packet B. Returns true only if
    /// both validated this cycle. A packet that fails keeps its last good
    /// values for up to MAX_HELD_FAILURES reads in a row, then resets to
    /// 0/false; fault_count() tracks every failure.
    bool poll() {
        const bool a_ok = process(kelly::CMD_PACKET_A);
        const bool b_ok = process(kelly::CMD_PACKET_B);
        return a_ok && b_ok;
    }

    uint16_t rpm() const noexcept { return rpm_; }
    bool reverse() const noexcept { return packet_a_.reverse; }
    const kelly::PacketA& packet_a() const noexcept { return packet_a_; }
    uint32_t fault_count() const noexcept { return fault_count_; }

private:
    bool process(uint8_t cmd) {
        kelly::Packet buf{};
        bool ok = exchange(cmd, buf);
        if (ok) {
            const kelly::PacketType type = kelly::determine_packet_type(buf);
            ok = (type != kelly::PacketType::Unknown) && kelly::validate_checksum(buf);
            if (ok) {
                if (type == kelly::PacketType::PacketA) {
                    kelly::parse_packet_a(buf, packet_a_);
                } else {
                    kelly::PacketB b{};
                    kelly::parse_packet_b(buf, b);
                    rpm_ = static_cast<uint16_t>(b.rpm / 4U);
                }
            } else {
                Serial.printf("[motor] Validation failed! type=%d, checksum_ok=%d\n", 
                    (int)type, kelly::validate_checksum(buf));
            }
        }
        uint8_t& failures = (cmd == kelly::CMD_PACKET_A) ? failures_a_ : failures_b_;
        if (ok) {
            failures = 0;
        } else {
            ++fault_count_;
            if (failures < kelly::MAX_HELD_FAILURES) {
                ++failures;
            } else if (cmd == kelly::CMD_PACKET_A) {
                packet_a_ = kelly::PacketA{};
            } else {
                rpm_ = 0;
            }
        }
        return ok;
    }

    bool exchange(uint8_t cmd, kelly::Packet& out) {
        flush_stale_input();
        const std::array<uint8_t, 3> command{ cmd, static_cast<uint8_t>(0x00), cmd };
        serial_.write(command.data(), command.size());
        serial_.flush(); // Wait for TX to complete
        
        unsigned long start_time = millis();
        int bytes_read = 0;
        bool synced = false;
        
        Serial.printf("[motor] RX (cmd %02X): ", cmd);
        
        while (millis() - start_time < serial_.getTimeout()) {
            if (serial_.available() > 0) {
                uint8_t b = serial_.read();
                Serial.printf("%02X ", b);
                
                if (!synced) {
                    if (b == cmd) {
                        out[0] = b;
                        synced = true;
                        bytes_read = 1;
                    }
                } else {
                    out[bytes_read++] = b;
                    if (bytes_read == out.size()) {
                        Serial.println();
                        return true;
                    }
                }
            }
        }
        
        Serial.printf(" | Timeout! bytes_read=%d\n", bytes_read);
        return false;
    }

    void flush_stale_input() {
        std::size_t discarded = 0;
        while (serial_.available() > 0 && discarded < kelly::FLUSH_MAX_BYTES) {
            serial_.read();
            ++discarded;
        }
    }

    HardwareSerial& serial_;
    uint16_t       rpm_         = 0;
    kelly::PacketA packet_a_{};
    uint32_t       fault_count_ = 0;
    /// Failed reads in a row, per packet type.
    uint8_t        failures_a_  = 0;
    uint8_t        failures_b_  = 0;
};
