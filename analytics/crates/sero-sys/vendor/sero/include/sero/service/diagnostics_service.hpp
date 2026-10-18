#pragma once
/// @file diagnostics_service.hpp
/// Built-in Diagnostics Service (0xFFFE) — OBD-II style remote DTC/counter
/// query for Sero devices (§10).

#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"
#include "sero/core/log.hpp"
#include "sero/core/message_header.hpp"
#include "sero/core/diagnostic_counters.hpp"
#include "sero/core/dtc_store.hpp"
#include "sero/service/service.hpp"
#include "sero/service/method_dispatcher.hpp"

namespace sero {

/// Built-in diagnostics service.  Registered via Runtime::enable_diagnostics().
/// Exposes DTC storage, protocol counters, service list, and device info
/// over the standard Sero request/response mechanism.
///
/// Wire payloads (all big-endian):
///
///   DIAG_GET_DTCS (0x0001)
///     Request : (empty)
///     Response: [2B count][N × 16B: code(2) severity(1) status(1)
///               occ_count(4) first_seen(4) last_seen(4)]
///
///   DIAG_CLEAR_DTCS (0x0002)
///     Request : [2B code]  (0xFFFF = clear all)
///     Response: (empty, E_OK)
///
///   DIAG_GET_COUNTERS (0x0003)
///     Request : (empty)
///     Response: [9 × 4B counters in DiagnosticCounter enum order] = 36 bytes
///
///   DIAG_GET_SERVICE_LIST (0x0004)
///     Request : (empty)
///     Response: [2B count][N × 6B: service_id(2) major(1) minor(1)
///               auth_required(1) ready(1)]
///
///   DIAG_GET_DEVICE_INFO (0x0005)
///     Request : (empty)
///     Response: [2B client_id][4B uptime_ms][1B protocol_version][1B reserved] = 8 bytes
///
template <typename Config>
class DiagnosticsService : public IService<DiagnosticsService<Config>> {
public:
    DiagnosticsService() = default;

    void set_logger(Logger<Config>* logger) { logger_ = logger; }

    /// Wire up the service to the runtime internals.
    void init(DtcStore<Config>* dtcs,
              const DiagnosticCounters* counters,
              const MethodDispatcher<Config>* dispatcher,
              uint16_t client_id,
              const uint32_t* uptime_ms_ptr)
    {
        dtcs_       = dtcs;
        counters_   = counters;
        dispatcher_ = dispatcher;
        client_id_  = client_id;
        uptime_ptr_ = uptime_ms_ptr;
    }

    ReturnCode impl_on_request(uint16_t method_id,
                               const uint8_t* payload,
                               std::size_t payload_length,
                               uint8_t* response,
                               std::size_t& response_length)
    {
        if (logger_) logger_->debug(LogCategory::Diagnostics, "diag_request",
                                     DIAG_SERVICE_ID, method_id, 0, 0);
        auto method = static_cast<DiagMethod>(method_id);
        switch (method) {
            case DiagMethod::DIAG_GET_DTCS:
                return handle_get_dtcs(response, response_length);
            case DiagMethod::DIAG_CLEAR_DTCS:
                return handle_clear_dtcs(payload, payload_length,
                                         response, response_length);
            case DiagMethod::DIAG_GET_COUNTERS:
                return handle_get_counters(response, response_length);
            case DiagMethod::DIAG_GET_SERVICE_LIST:
                return handle_get_service_list(response, response_length);
            case DiagMethod::DIAG_GET_DEVICE_INFO:
                return handle_get_device_info(response, response_length);
            default:
                response_length = 0;
                return ReturnCode::E_UNKNOWN_METHOD;
        }
    }

    bool impl_is_ready() const {
        return dtcs_ != nullptr && counters_ != nullptr && dispatcher_ != nullptr;
    }

private:
    DtcStore<Config>*              dtcs_       = nullptr;
    const DiagnosticCounters*      counters_   = nullptr;
    const MethodDispatcher<Config>* dispatcher_ = nullptr;
    uint16_t                       client_id_  = 0;
    const uint32_t*                uptime_ptr_ = nullptr;
    Logger<Config>*                logger_     = nullptr;

    // ── GET_DTCS ────────────────────────────────────────────────

    ReturnCode handle_get_dtcs(uint8_t* response,
                               std::size_t& response_length) const
    {
        if (response_length < 2) {
            response_length = 0;
            return ReturnCode::E_NOT_OK;
        }

        const std::size_t capacity = response_length;
        std::size_t offset = 0;
        // Reserve 2 bytes for count (filled after iteration)
        offset += 2;

        uint16_t n = 0;
        dtcs_->for_each([&](const Dtc& d) {
            if (offset + 16 > capacity) return;
            MessageHeader::write_u16(response + offset, d.code);          offset += 2;
            response[offset++] = d.severity;
            response[offset++] = d.active ? uint8_t(1) : uint8_t(0);
            MessageHeader::write_u32(response + offset, d.occurrence_count); offset += 4;
            MessageHeader::write_u32(response + offset, d.first_seen_ms);   offset += 4;
            MessageHeader::write_u32(response + offset, d.last_seen_ms);    offset += 4;
            ++n;
        });

        MessageHeader::write_u16(response, n);
        response_length = offset;
        return ReturnCode::E_OK;
    }

    // ── CLEAR_DTCS ──────────────────────────────────────────────

    ReturnCode handle_clear_dtcs(const uint8_t* payload,
                                 std::size_t payload_length,
                                 uint8_t* /*response*/,
                                 std::size_t& response_length)
    {
        if (payload_length < 2) {
            response_length = 0;
            return ReturnCode::E_MALFORMED_MESSAGE;
        }
        uint16_t code = MessageHeader::read_u16(payload);
        if (code == 0xFFFF) {
            dtcs_->clear_all();
        } else {
            if (!dtcs_->clear(code)) {
                response_length = 0;
                return ReturnCode::E_NOT_OK;
            }
        }
        response_length = 0;
        return ReturnCode::E_OK;
    }

    // ── GET_COUNTERS ────────────────────────────────────────────

    ReturnCode handle_get_counters(uint8_t* response,
                                   std::size_t& response_length) const
    {
        constexpr std::size_t N = static_cast<std::size_t>(DiagnosticCounter::_Count);
        constexpr std::size_t RequiredSize = N * 4;
        if (response_length < RequiredSize) {
            response_length = 0;
            return ReturnCode::E_NOT_OK;
        }
        for (std::size_t i = 0; i < N; ++i) {
            MessageHeader::write_u32(
                response + i * 4,
                counters_->get(static_cast<DiagnosticCounter>(i)));
        }
        response_length = RequiredSize;
        return ReturnCode::E_OK;
    }

    // ── GET_SERVICE_LIST ────────────────────────────────────────

    ReturnCode handle_get_service_list(uint8_t* response,
                                       std::size_t& response_length) const
    {
        if (response_length < 2) {
            response_length = 0;
            return ReturnCode::E_NOT_OK;
        }

        const std::size_t capacity = response_length;
        std::size_t offset = 2;  // reserve 2 bytes for count
        uint16_t n = 0;
        dispatcher_->for_each([&](const ServiceEntry& se) {
            if (offset + 6 > capacity) return;
            MessageHeader::write_u16(response + offset, se.service_id);  offset += 2;
            response[offset++] = se.major_version;
            response[offset++] = se.minor_version;
            response[offset++] = se.auth_required ? uint8_t(1) : uint8_t(0);
            response[offset++] = se.is_ready_fn(se.context) ? uint8_t(1) : uint8_t(0);
            ++n;
        });
        MessageHeader::write_u16(response, n);
        response_length = offset;
        return ReturnCode::E_OK;
    }

    // ── GET_DEVICE_INFO ─────────────────────────────────────────

    ReturnCode handle_get_device_info(uint8_t* response,
                                      std::size_t& response_length) const
    {
        if (response_length < 8) {
            response_length = 0;
            return ReturnCode::E_NOT_OK;
        }
        MessageHeader::write_u16(response,     client_id_);
        MessageHeader::write_u32(response + 2, uptime_ptr_ ? *uptime_ptr_ : 0);
        response[6] = PROTOCOL_VERSION;
        response[7] = 0; // reserved
        response_length = 8;
        return ReturnCode::E_OK;
    }
};

} // namespace sero
