#pragma once
/// @file message_authenticator.hpp
/// Per-peer HMAC key storage + HMAC-128 compute / verify (§7.3).

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "sero/core/types.hpp"
#include "sero/core/log.hpp"
#include "sero/security/hmac.hpp"
#include "sero/core/message_header.hpp"

namespace sero {

template <typename Config>
class MessageAuthenticator {
public:
    using Addr = Address<Config>;

    MessageAuthenticator() = default;

    void set_logger(Logger<Config>* logger) { logger_ = logger; }

    /// Register or update HMAC key for a peer address.
    bool set_key(const Addr& peer, const uint8_t* key) {
        // Update existing entry
        for (std::size_t i = 0; i < key_count_; ++i) {
            if (keys_[i].address == peer) {
                std::memcpy(keys_[i].key.data(), key, Config::HmacKeySize);
                if (logger_) logger_->info(LogCategory::Auth, "key_updated",
                                            0, 0, 0, 0);
                return true;
            }
        }
        // New entry
        if (key_count_ < Config::MaxTrackedPeers) {
            keys_[key_count_].address = peer;
            std::memcpy(keys_[key_count_].key.data(), key, Config::HmacKeySize);
            ++key_count_;
            if (logger_) logger_->info(LogCategory::Auth, "key_added",
                                        0, 0, 0,
                                        static_cast<uint32_t>(key_count_));
            return true;
        }
        if (logger_) logger_->warn(LogCategory::Auth, "key_table_full",
                                    0, 0, 0,
                                    static_cast<uint32_t>(key_count_));
        return false; // table full
    }

    /// Compute HMAC-128 over header (20B) + payload.
    /// Returns false if no key for this peer.
    bool compute(const uint8_t* header_20, const uint8_t* payload,
                 std::size_t payload_len, const Addr& peer,
                 uint8_t out[16]) const
    {
        const KeyEntry* ke = find_key(peer);
        if (!ke) return false;

        // Concatenate header + payload into a temp buffer on the stack
        // Max size: 20 + MaxPayloadSize
        // For HMAC we can use two-part update.
        // We'll do it via incremental approach to avoid large stack buffer.
        // Actually, hmac_sha256 takes a single contiguous buffer. Let's use
        // a two-update approach with the raw sha256 primitives.
        compute_hmac_two_part(ke->key.data(), Config::HmacKeySize,
                              header_20, MessageHeader::SIZE,
                              payload, payload_len,
                              out);
        return true;
    }

    /// Verify HMAC-128 over header + payload against received_hmac.
    /// Returns false if no key for peer or HMAC mismatch.
    bool verify(const uint8_t* header_20, const uint8_t* payload,
                std::size_t payload_len, const Addr& peer,
                const uint8_t* received_hmac) const
    {
        uint8_t computed[16];
        if (!compute(header_20, payload, payload_len, peer, computed)) {
            if (logger_) logger_->debug(LogCategory::Auth, "verify_no_key",
                                         0, 0, 0, 0);
            return false;
        }
        bool ok = hmac_equal(computed, received_hmac);
        if (!ok && logger_) logger_->warn(LogCategory::Auth, "verify_mismatch",
                                           0, 0, 0, 0);
        return ok;
    }

    bool has_key(const Addr& peer) const {
        return find_key(peer) != nullptr;
    }

private:
    struct KeyEntry {
        Addr address{};
        std::array<uint8_t, Config::HmacKeySize> key{};
    };

    std::array<KeyEntry, Config::MaxTrackedPeers> keys_{};
    std::size_t key_count_ = 0;
    Logger<Config>* logger_ = nullptr;

    const KeyEntry* find_key(const Addr& peer) const {
        for (std::size_t i = 0; i < key_count_; ++i) {
            if (keys_[i].address == peer) return &keys_[i];
        }
        return nullptr;
    }

    /// Two-part HMAC: HMAC-SHA256(key, header || payload), truncated to 128 bits.
    static void compute_hmac_two_part(const uint8_t* key, std::size_t key_len,
                                      const uint8_t* part1, std::size_t part1_len,
                                      const uint8_t* part2, std::size_t part2_len,
                                      uint8_t out[16])
    {
        constexpr std::size_t BLOCK = Sha256::BLOCK_SIZE;

        uint8_t k_prime[BLOCK];
        if (key_len > BLOCK) {
            Sha256::hash(key, key_len, k_prime);
            std::memset(k_prime + Sha256::DIGEST_SIZE, 0, BLOCK - Sha256::DIGEST_SIZE);
        } else {
            std::memcpy(k_prime, key, key_len);
            std::memset(k_prime + key_len, 0, BLOCK - key_len);
        }

        // Inner: H((K' ^ ipad) || part1 || part2)
        uint8_t ipad_block[BLOCK]{};
        for (std::size_t i = 0; i < BLOCK; ++i) {
            ipad_block[i] = k_prime[i] ^ 0x36;
        }
        Sha256 inner;
        inner.update(ipad_block, BLOCK);
        inner.update(part1, part1_len);
        inner.update(part2, part2_len);
        uint8_t inner_hash[Sha256::DIGEST_SIZE];
        inner.finalize(inner_hash);

        // Outer: H((K' ^ opad) || inner_hash)
        uint8_t opad_block[BLOCK]{};
        for (std::size_t i = 0; i < BLOCK; ++i) {
            opad_block[i] = k_prime[i] ^ 0x5c;
        }
        Sha256 outer;
        outer.update(opad_block, BLOCK);
        outer.update(inner_hash, Sha256::DIGEST_SIZE);
        uint8_t full[Sha256::DIGEST_SIZE];
        outer.finalize(full);

        std::memcpy(out, full, 16);
    }
};

} // namespace sero
