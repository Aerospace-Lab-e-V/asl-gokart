#pragma once
/// @file hmac.hpp
/// HMAC-SHA256 and HMAC-SHA256 truncated to 128 bits (§7.3).

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "sero/security/sha256.hpp"

namespace sero {

/// Compute full 32-byte HMAC-SHA256.
/// Standard construction: H((K' ^ opad) || H((K' ^ ipad) || message))
inline void hmac_sha256(const uint8_t* key, std::size_t key_len,
                        const uint8_t* data, std::size_t data_len,
                        uint8_t out[32])
{
    constexpr std::size_t BLOCK = Sha256::BLOCK_SIZE; // 64
    uint8_t k_prime[BLOCK];

    // Derive K'
    if (key_len > BLOCK) {
        Sha256::hash(key, key_len, k_prime);
        std::memset(k_prime + Sha256::DIGEST_SIZE, 0, BLOCK - Sha256::DIGEST_SIZE);
    } else {
        std::memcpy(k_prime, key, key_len);
        std::memset(k_prime + key_len, 0, BLOCK - key_len);
    }

    // Inner hash: H((K' ^ ipad) || message)
    uint8_t ipad_block[BLOCK];
    for (std::size_t i = 0; i < BLOCK; ++i) {
        ipad_block[i] = k_prime[i] ^ 0x36;
    }
    Sha256 inner;
    inner.update(ipad_block, BLOCK);
    inner.update(data, data_len);
    uint8_t inner_hash[Sha256::DIGEST_SIZE];
    inner.finalize(inner_hash);

    // Outer hash: H((K' ^ opad) || inner_hash)
    uint8_t opad_block[BLOCK];
    for (std::size_t i = 0; i < BLOCK; ++i) {
        opad_block[i] = k_prime[i] ^ 0x5c;
    }
    Sha256 outer;
    outer.update(opad_block, BLOCK);
    outer.update(inner_hash, Sha256::DIGEST_SIZE);
    outer.finalize(out);
}

/// Compute HMAC-SHA256 truncated to 128 bits (16 bytes).
inline void hmac_sha256_128(const uint8_t* key, std::size_t key_len,
                            const uint8_t* data, std::size_t data_len,
                            uint8_t out[16])
{
    uint8_t full[32];
    hmac_sha256(key, key_len, data, data_len, full);
    std::memcpy(out, full, 16);
}

/// Constant-time comparison of two 16-byte HMAC digests.
inline bool hmac_equal(const uint8_t a[16], const uint8_t b[16]) {
    uint8_t diff = 0;
    for (int i = 0; i < 16; ++i) {
        diff |= (a[i] ^ b[i]);
    }
    return diff == 0;
}

} // namespace sero
