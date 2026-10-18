#pragma once
/// @file log.hpp
/// Real-time safe structured logging for Sero.
///
/// Design principles:
///   - Zero overhead when disabled: Config::MinLogLevel = LogLevel::Off
///     causes all log calls to be eliminated at compile time via if constexpr.
///   - No heap allocation, no formatting, no mutexes — safe for bare-metal
///     and RTOS environments.
///   - Structured data only: the user-provided callback receives a LogEntry
///     with level, category, a const char* tag (string literal), and numeric
///     context fields. The callback decides how to format/output.
///   - Function-pointer callback matches the existing DiagnosticCallback
///     pattern used elsewhere in the library.

#include <cstdint>

namespace sero {

// ── Log Level ──────────────────────────────────────────────────

/// Severity levels, ordered from most verbose to most critical.
/// Set Config::MinLogLevel to control compile-time filtering.
/// LogLevel::Off disables all logging (default).
enum class LogLevel : uint8_t {
    Trace = 0,   ///< Very fine-grained (per-packet accept, HMAC compute)
    Debug = 1,   ///< Detailed operational (dispatch, first-seen, state changes)
    Info  = 2,   ///< Noteworthy events (service registered, offer started)
    Warn  = 3,   ///< Validation failures, table-full, timeout evictions
    Error = 4,   ///< Serious failures (auth fail, CRC error)
    Off   = 5,   ///< Logging disabled — all calls compile to nothing
};

// ── Log Category ───────────────────────────────────────────────

/// Broad categories for filtering in the user callback.
enum class LogCategory : uint8_t {
    Validation,       ///< Receive-path validation pipeline
    Dispatch,         ///< Message type routing
    ServiceDiscovery, ///< SD offers, finds, subscriptions, TTL management
    E2E,              ///< Sequence counter tracking
    Auth,             ///< HMAC key management, compute, verify
    Transport,        ///< Send / broadcast failures
    Events,           ///< Event registration, subscription, notification
    Requests,         ///< Request tracking, completion, timeouts
    Methods,          ///< Service registration, method dispatch
    Diagnostics,      ///< Built-in diagnostics service operations
    General,          ///< Catch-all
};

// ── Log Entry ──────────────────────────────────────────────────

/// Structured log record passed to the user callback.
/// All pointers are valid only for the duration of the callback invocation.
/// The tag field is always a string literal (lives in .rodata).
struct LogEntry {
    LogLevel    level;
    LogCategory category;
    const char* tag;              ///< Short identifier, e.g. "crc_fail", "offer_rx"
    uint16_t    service_id;       ///< Context: service ID (0 if N/A)
    uint16_t    method_event_id;  ///< Context: method or event ID (0 if N/A)
    uint16_t    client_id;        ///< Context: client ID (0 if N/A)
    uint32_t    extra;            ///< Context: tag-dependent value (return code,
                                  ///< sequence counter, payload length, etc.)
};

// ── Callback type ──────────────────────────────────────────────

/// User-provided log sink. Must be safe to call from any context
/// (ISR, main loop, RTOS task). Should be fast — do not block.
using LogCallback = void (*)(const LogEntry& entry, void* user_ctx);

// ── Logger ─────────────────────────────────────────────────────

/// Compile-time filtered, zero-overhead logger.
///
/// When Config::MinLogLevel == LogLevel::Off (the default), every log()
/// call is eliminated by the compiler thanks to `if constexpr`.
///
/// Usage inside subsystems:
///   logger->log<LogLevel::Warn>(LogCategory::Validation, "crc_fail",
///                               hdr.service_id, hdr.method_event_id,
///                               hdr.client_id, payload_length);
template <typename Config>
class Logger {
public:
    Logger() = default;

    void set_callback(LogCallback cb, void* ctx) {
        callback_     = cb;
        callback_ctx_ = ctx;
    }

    /// Core log function. Eliminated at compile time when Level < MinLogLevel.
    template <LogLevel Level>
    void log(LogCategory category, const char* tag,
             uint16_t service_id      = 0,
             uint16_t method_event_id = 0,
             uint16_t client_id       = 0,
             uint32_t extra           = 0) const
    {
        if constexpr (static_cast<uint8_t>(Level) >=
                      static_cast<uint8_t>(Config::MinLogLevel)) {
            if (callback_) {
                LogEntry entry{Level, category, tag,
                               service_id, method_event_id, client_id, extra};
                callback_(entry, callback_ctx_);
            }
        }
    }

    // ── Convenience wrappers ────────────────────────────────────

    void trace(LogCategory cat, const char* tag,
               uint16_t sid = 0, uint16_t mid = 0,
               uint16_t cid = 0, uint32_t extra = 0) const
    { log<LogLevel::Trace>(cat, tag, sid, mid, cid, extra); }

    void debug(LogCategory cat, const char* tag,
               uint16_t sid = 0, uint16_t mid = 0,
               uint16_t cid = 0, uint32_t extra = 0) const
    { log<LogLevel::Debug>(cat, tag, sid, mid, cid, extra); }

    void info(LogCategory cat, const char* tag,
              uint16_t sid = 0, uint16_t mid = 0,
              uint16_t cid = 0, uint32_t extra = 0) const
    { log<LogLevel::Info>(cat, tag, sid, mid, cid, extra); }

    void warn(LogCategory cat, const char* tag,
              uint16_t sid = 0, uint16_t mid = 0,
              uint16_t cid = 0, uint32_t extra = 0) const
    { log<LogLevel::Warn>(cat, tag, sid, mid, cid, extra); }

    void error(LogCategory cat, const char* tag,
               uint16_t sid = 0, uint16_t mid = 0,
               uint16_t cid = 0, uint32_t extra = 0) const
    { log<LogLevel::Error>(cat, tag, sid, mid, cid, extra); }

private:
    LogCallback callback_     = nullptr;
    void*       callback_ctx_ = nullptr;
};

} // namespace sero
