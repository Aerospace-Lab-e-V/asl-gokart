#pragma once
/// @file e2e_protection.hpp
/// CRC-16 integration + sequence counter tracking (§7.1, §7.2).

#include <array>
#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"
#include "sero/core/log.hpp"

namespace sero {

/// Result of sequence counter validation.
enum class SeqResult : uint8_t {
    Accept,     ///< Within acceptance window.
    Duplicate,  ///< delta == 0.
    Stale,      ///< delta > window.
    FirstSeen,  ///< New peer — unconditionally accepted.
    TableFull,  ///< Tracking table full — accepted without validation.
};

template <typename Config>
class E2EProtection {
public:
    using Addr = Address<Config>;

    E2EProtection() = default;

    void set_logger(Logger<Config>* logger) { logger_ = logger; }

    /// Get the next outgoing sequence number and increment.
    uint8_t next_sequence() {
        uint8_t seq = tx_seq_;
        ++tx_seq_; // wraps at 0xFF→0x00
        return seq;
    }

    /// Reset tracking state for a peer (e.g. after reboot detection).
    /// This allows the restarted peer's sequence counters to be accepted fresh.
    void reset_peer(const Addr& source) {
        for (std::size_t i = 0; i < peer_count_; ++i) {
            if (peers_[i].address == source) {
                // Remove by compacting
                if (i != peer_count_ - 1) peers_[i] = peers_[peer_count_ - 1];
                peers_[peer_count_ - 1] = PeerEntry{};
                --peer_count_;
                if (logger_) logger_->debug(LogCategory::E2E, "peer_reset",
                                             0, 0, 0, 0);
                return;
            }
        }
    }

    /// Validate an incoming sequence counter from a peer.
    SeqResult validate_sequence(const Addr& source, uint8_t received_seq) {
        // Find existing peer entry
        for (std::size_t i = 0; i < peer_count_; ++i) {
            if (peers_[i].address == source) {
                uint8_t delta = static_cast<uint8_t>(received_seq - peers_[i].last_seen);
                if (delta == 0) {
                    if (logger_) logger_->warn(LogCategory::E2E, "seq_duplicate",
                                                0, 0, 0, received_seq);
                    return SeqResult::Duplicate;
                }
                if (delta <= Config::SeqCounterAcceptWindow) {
                    peers_[i].last_seen = received_seq;
                    if (logger_) logger_->trace(LogCategory::E2E, "seq_accept",
                                                 0, 0, 0, received_seq);
                    return SeqResult::Accept;
                }
                // delta > window → stale
                if (logger_) logger_->warn(LogCategory::E2E, "seq_stale",
                                            0, 0, 0, received_seq);
                return SeqResult::Stale;
            }
        }

        // New peer
        if (peer_count_ < Config::MaxTrackedPeers) {
            peers_[peer_count_].address   = source;
            peers_[peer_count_].last_seen = received_seq;
            ++peer_count_;
            if (logger_) logger_->debug(LogCategory::E2E, "seq_first_seen",
                                         0, 0, 0, received_seq);
            return SeqResult::FirstSeen;
        }

        // Table full — accept without validation
        if (logger_) logger_->warn(LogCategory::E2E, "seq_table_full",
                                    0, 0, 0, received_seq);
        return SeqResult::TableFull;
    }

private:
    struct PeerEntry {
        Addr    address{};
        uint8_t last_seen = 0;
    };

    std::array<PeerEntry, Config::MaxTrackedPeers> peers_{};
    std::size_t peer_count_ = 0;
    uint8_t     tx_seq_     = 0;
    Logger<Config>* logger_ = nullptr;
};

} // namespace sero
