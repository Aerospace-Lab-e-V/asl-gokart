#pragma once
/// @file diagnostic_counters.hpp
/// Diagnostic counters and optional discard callback (§9).

#include <algorithm>
#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"

namespace sero {

/// Callback type for diagnostic events.
/// @param counter  Which counter was incremented.
/// @param header   Pointer to the raw 20-byte header, or nullptr if the
///                 message was too short to contain one.
/// @param user_ctx User-provided context pointer.
using DiagnosticCallback = void (*)(DiagnosticCounter counter,
                                    const uint8_t* header,
                                    void* user_ctx);

struct DiagnosticCounters {
    uint32_t counters[static_cast<std::size_t>(DiagnosticCounter::_Count)]{};
    DiagnosticCallback callback = nullptr;
    void* callback_ctx = nullptr;

    void set_callback(DiagnosticCallback cb, void* ctx) {
        callback = cb;
        callback_ctx = ctx;
    }

    void increment(DiagnosticCounter c, const uint8_t* header_or_null = nullptr) {
        auto idx = static_cast<std::size_t>(c);
        if (counters[idx] < UINT32_MAX) ++counters[idx]; // saturating
        if (callback) {
            callback(c, header_or_null, callback_ctx);
        }
    }

    uint32_t get(DiagnosticCounter c) const {
        return counters[static_cast<std::size_t>(c)];
    }

    void reset() {
        std::fill(std::begin(counters), std::end(counters), uint32_t{0});
    }
};

} // namespace sero
