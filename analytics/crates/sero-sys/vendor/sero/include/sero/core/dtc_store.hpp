#pragma once
/// @file dtc_store.hpp
/// Fixed-size Diagnostic Trouble Code (DTC) store (§10.1).
/// OBD-II style: application-defined uint16_t codes with severity,
/// occurrence counting, and timestamps.

#include <array>
#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"

namespace sero {

/// A single Diagnostic Trouble Code entry (16 bytes).
struct Dtc {
    uint16_t code            = 0;
    uint8_t  severity        = 0;  ///< DtcSeverity value.
    bool     active          = false;
    uint32_t occurrence_count = 0;
    uint32_t first_seen_ms   = 0;
    uint32_t last_seen_ms    = 0;
};

/// Fixed-size DTC store.  Report / clear / iterate trouble codes.
/// @tparam Config  Compile-time config with MaxDtcs member.
template <typename Config>
class DtcStore {
public:
    /// Report (or re-report) a DTC.
    /// If the code already exists its occurrence count and last_seen are updated.
    /// If the table is full the report is silently dropped (returns false).
    bool report(uint16_t code, DtcSeverity severity, uint32_t now_ms) {
        // Update existing?
        for (std::size_t i = 0; i < count_; ++i) {
            if (dtcs_[i].active && dtcs_[i].code == code) {
                dtcs_[i].severity = static_cast<uint8_t>(severity);
                if (dtcs_[i].occurrence_count < UINT32_MAX) dtcs_[i].occurrence_count++;
                dtcs_[i].last_seen_ms = now_ms;
                return true;
            }
        }
        // Insert new
        if (count_ >= Config::MaxDtcs) return false;
        Dtc& d        = dtcs_[count_];
        d.code            = code;
        d.severity        = static_cast<uint8_t>(severity);
        d.active          = true;
        d.occurrence_count = 1;
        d.first_seen_ms   = now_ms;
        d.last_seen_ms    = now_ms;
        ++count_;
        return true;
    }

    /// Clear a single DTC by code.  Returns true if found and removed.
    bool clear(uint16_t code) {
        for (std::size_t i = 0; i < count_; ++i) {
            if (dtcs_[i].active && dtcs_[i].code == code) {
                if (i != count_ - 1) dtcs_[i] = dtcs_[count_ - 1];
                dtcs_[count_ - 1] = Dtc{};
                --count_;
                return true;
            }
        }
        return false;
    }

    /// Clear all DTCs.
    void clear_all() {
        for (std::size_t i = 0; i < count_; ++i) {
            dtcs_[i] = Dtc{};
        }
        count_ = 0;
    }

    /// Find a DTC by code (nullptr if not present).
    const Dtc* find(uint16_t code) const {
        for (std::size_t i = 0; i < count_; ++i) {
            if (dtcs_[i].active && dtcs_[i].code == code) {
                return &dtcs_[i];
            }
        }
        return nullptr;
    }

    /// Number of active DTCs.
    std::size_t count() const { return count_; }

    /// Iterate all active DTCs.
    template <typename Fn>
    void for_each(Fn&& fn) const {
        for (std::size_t i = 0; i < count_; ++i) {
            if (dtcs_[i].active) fn(dtcs_[i]);
        }
    }

private:
    std::array<Dtc, Config::MaxDtcs> dtcs_{};
    std::size_t count_ = 0;
};

} // namespace sero
