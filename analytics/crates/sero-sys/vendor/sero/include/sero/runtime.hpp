#pragma once
/// @file runtime.hpp
/// Top-level coordinator — Runtime::process() cycle (§10.3).

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <optional>

#include "sero/core/config.hpp"
#include "sero/core/types.hpp"
#include "sero/core/log.hpp"
#include "sero/core/message_header.hpp"
#include "sero/security/crc16.hpp"
#include "sero/security/e2e_protection.hpp"
#include "sero/security/message_authenticator.hpp"
#include "sero/core/diagnostic_counters.hpp"
#include "sero/core/dtc_store.hpp"
#include "sero/service/service_discovery.hpp"
#include "sero/service/method_dispatcher.hpp"
#include "sero/service/event_manager.hpp"
#include "sero/service/request_tracker.hpp"
#include "sero/service/service.hpp"
#include "sero/service/event_handler.hpp"
#include "sero/service/diagnostics_service.hpp"

namespace sero {

template <typename TransportImpl, typename Config = DefaultConfig>
class Runtime {
public:
    using Addr = Address<Config>;

    static constexpr std::size_t MAX_MSG_SIZE =
        MessageHeader::SIZE + Config::MaxPayloadSize + HMAC_SIZE + CRC_SIZE;

    // Compile-time sanity checks for config products that determine RAM usage.
    static_assert(Config::MaxServices * Config::MaxEvents <= 1024,
        "MaxServices * MaxEvents is very large — review RAM budget");
    static_assert(Config::MaxKnownServices * Config::MaxEvents <= 1024,
        "MaxKnownServices * MaxEvents is very large — review RAM budget");
    static_assert(Config::MaxPayloadSize <= 8192,
        "MaxPayloadSize exceeds 8 KB — review RAM budget");

    // ── Construction ────────────────────────────────────────────

    Runtime(TransportImpl& transport, uint16_t client_id)
        : transport_(transport)
        , client_id_(client_id)
    {
        sd_.set_client_id(client_id);
        sd_.set_logger(&logger_);
        e2e_.set_logger(&logger_);
        authenticator_.set_logger(&logger_);
        event_manager_.set_logger(&logger_);
        request_tracker_.set_logger(&logger_);
        dispatcher_.set_logger(&logger_);
        diag_service_.set_logger(&logger_);
    }

    /// Set the local transport address (needed for SD offers).
    void set_local_address(const Addr& addr) {
        local_addr_ = addr;
        sd_.set_local_address(addr);
    }

    // ── Main process cycle (§10.3) ──────────────────────────────

    void process(uint32_t now_ms) {
        // Track uptime (first call establishes epoch)
        if (!uptime_started_) {
            uptime_started_ = true;
            uptime_epoch_ms_ = now_ms;
        }
        uptime_ms_ = now_ms - uptime_epoch_ms_;

        // 1. Drain transport (bounded to prevent starvation)
        Addr source{};
        const uint8_t* data = nullptr;
        std::size_t length = 0;
        for (std::size_t drain = 0;
             drain < Config::MaxReceiveQueueSize && transport_.poll(source, data, length);
             ++drain) {
            validate_and_dispatch(source, data, length, now_ms);
        }

        // 2. Evict timed-out pending requests
        request_tracker_.evict_expired(now_ms);

        // 3. Evict expired subscriptions (provider side)
        event_manager_.evict_expired(now_ms);

        // 4. Re-broadcast offers at TTL/2
        sd_.process_offers(now_ms, [this](const uint8_t* msg, std::size_t len) {
            send_sd_broadcast(msg, len);
        });

        // 5. Re-send subscription renewals at granted-TTL/2
        sd_.process_subscription_renewals(now_ms,
            [this](const Addr& dest, const uint8_t* msg, std::size_t len) {
                send_sd_unicast(dest, msg, len);
            });

        // 6. Transition expired consumer SD entries → NOT_FOUND
        //    Reset E2E peer state so a restarted provider's sequence
        //    counters are accepted fresh (not rejected as Stale).
        sd_.process_consumer_ttls(now_ms, [this](const Addr& expired_peer) {
            e2e_.reset_peer(expired_peer);
        });

        // 7. Process SD_FIND retries
        sd_.process_finds(now_ms, [this](const uint8_t* msg, std::size_t len) {
            send_sd_broadcast(msg, len);
        });
    }

    // ── Service registration (provider side) ────────────────────

    template <typename Impl>
    [[nodiscard]] bool register_service(uint16_t service_id, IService<Impl>& svc,
                          uint8_t major, uint8_t minor,
                          bool auth_required = false)
    {
        return dispatcher_.register_service(
            make_service_entry(service_id, svc, major, minor, auth_required));
    }

    bool unregister_service(uint16_t service_id) {
        return dispatcher_.unregister_service(service_id);
    }

    /// Register an event that this device can produce notifications for.
    [[nodiscard]] bool register_event(uint16_t service_id, uint16_t event_id) {
        return event_manager_.register_event(service_id, event_id);
    }

    // ── Service offering (provider SD) ──────────────────────────

    [[nodiscard]] bool offer_service(uint16_t service_id, uint16_t ttl_seconds, uint32_t now_ms) {
        const ServiceEntry* se = dispatcher_.find(service_id);
        if (!se) return false;
        return sd_.offer(service_id, se->major_version, se->minor_version,
                         ttl_seconds, now_ms);
    }

    void stop_offer(uint16_t service_id) {
        sd_.stop_offer(service_id);
    }

    // ── Service discovery (consumer SD) ─────────────────────────

    [[nodiscard]] bool find_service(uint16_t service_id, uint8_t major_version, uint32_t now_ms) {
        return sd_.find(service_id, major_version, now_ms);
    }

    SdCallbacks<Config>& sd_callbacks() { return sd_.callbacks(); }

    // ── Method invocation (client side, §5) ─────────────────────

    /// Send a REQUEST and track the pending response.
    /// Returns the request_id or std::nullopt if failed.
    [[nodiscard]] std::optional<uint32_t> request(uint16_t service_id,
                                    uint16_t method_id,
                                    const uint8_t* payload,
                                    std::size_t payload_length,
                                    RequestCallback callback,
                                    void* user_ctx,
                                    uint32_t timeout_ms,
                                    uint32_t now_ms)
    {
        Addr provider{};
        if (!sd_.get_provider_address(service_id, provider)) {
            return std::nullopt; // service not found
        }
        return request_impl(provider, service_id, method_id, payload, payload_length,
                            callback, user_ctx, timeout_ms, now_ms);
    }

    /// Send a REQUEST to an explicit target address, bypassing SD lookup.
    /// Use this when you manage multiple providers of the same service_id
    /// (e.g. a diagnostic scanner querying each discovered device directly).
    std::optional<uint32_t> request(const Addr& target,
                                    uint16_t service_id,
                                    uint16_t method_id,
                                    const uint8_t* payload,
                                    std::size_t payload_length,
                                    RequestCallback callback,
                                    void* user_ctx,
                                    uint32_t timeout_ms,
                                    uint32_t now_ms)
    {
        return request_impl(target, service_id, method_id, payload, payload_length,
                            callback, user_ctx, timeout_ms, now_ms);
    }

    /// Fire-and-forget REQUEST_NO_RETURN (§5.2).
    [[nodiscard]] bool fire_and_forget(uint16_t service_id, uint16_t method_id,
                         const uint8_t* payload, std::size_t payload_length)
    {
        Addr provider{};
        if (!sd_.get_provider_address(service_id, provider)) return false;

        bool auth = should_auth_outgoing(provider);
        MessageHeader hdr{};
        hdr.version          = PROTOCOL_VERSION;
        hdr.message_type     = static_cast<uint8_t>(MessageType::REQUEST_NO_RETURN);
        hdr.return_code      = 0;
        hdr.flags            = auth ? FLAG_AUTH : uint8_t(0);
        hdr.service_id       = service_id;
        hdr.method_event_id  = method_id;
        hdr.client_id        = client_id_;
        hdr.sequence_counter = e2e_.next_sequence();
        hdr.request_id       = REQUEST_ID_NONE;
        hdr.payload_length   = static_cast<uint32_t>(payload_length);

        std::size_t total = build_message(hdr, payload, payload_length, auth, provider);
        if (!transport_.send(provider, tx_buffer_, total)) {
            diag_.increment(DiagnosticCounter::DroppedMessages);
            logger_.warn(LogCategory::Transport, "fnf_send_fail",
                         service_id, method_id, client_id_, 0);
            return false;
        }
        logger_.debug(LogCategory::Dispatch, "fnf_tx",
                      service_id, method_id, client_id_,
                      static_cast<uint32_t>(payload_length));
        return true;
    }

    // ── Event subscription (consumer side, §6) ──────────────────

    /// Subscribe to a remote event. Handler receives notifications.
    template <typename Impl>
    [[nodiscard]] bool subscribe_event(uint16_t service_id, uint16_t event_id,
                         IEventHandler<Impl>& handler,
                         uint16_t ttl_seconds, uint32_t now_ms)
    {
        // Register the handler
        if (!register_event_handler(service_id, event_id, handler)) {
            return false;
        }
        // Start the subscription protocol
        return sd_.subscribe_event(service_id, event_id, ttl_seconds, now_ms);
    }

    bool unsubscribe_event(uint16_t service_id, uint16_t event_id) {
        unregister_event_handler(service_id, event_id);
        return sd_.unsubscribe_event(service_id, event_id);
    }

    // ── Event notification (provider side, §6.2) ────────────────

    /// Push a notification to all subscribers of an event.
    [[nodiscard]] bool notify_event(uint16_t service_id, uint16_t event_id,
                      const uint8_t* payload, std::size_t payload_length,
                      uint32_t /*now_ms*/ = 0)
    {
        if (!event_manager_.has_subscribers(service_id, event_id)) return false;

        event_manager_.notify(service_id, event_id,
            [&](const Addr& dest, uint16_t /*client_id*/) {
                bool auth = should_auth_outgoing(dest);
                MessageHeader hdr{};
                hdr.version          = PROTOCOL_VERSION;
                hdr.message_type     = static_cast<uint8_t>(MessageType::NOTIFICATION);
                hdr.return_code      = 0;
                hdr.flags            = auth ? FLAG_AUTH : uint8_t(0);
                hdr.service_id       = service_id;
                hdr.method_event_id  = event_id;
                hdr.client_id        = CLIENT_ID_PROVIDER;
                hdr.sequence_counter = e2e_.next_sequence();
                hdr.request_id       = REQUEST_ID_NONE;
                hdr.payload_length   = static_cast<uint32_t>(payload_length);

                std::size_t total = build_message(hdr, payload, payload_length, auth, dest);
                if (!transport_.send(dest, tx_buffer_, total)) {
                    diag_.increment(DiagnosticCounter::DroppedMessages);
                    logger_.warn(LogCategory::Transport, "notify_send_fail",
                                 service_id, event_id, 0, 0);
                }
            });
        return true;
    }

    // ── HMAC key management ─────────────────────────────────────

    bool set_hmac_key(const Addr& peer, const uint8_t* key) {
        return authenticator_.set_key(peer, key);
    }

    // ── Diagnostics ─────────────────────────────────────────────

    void set_diagnostic_callback(DiagnosticCallback cb, void* ctx) {
        diag_.set_callback(cb, ctx);
    }

    const DiagnosticCounters& diagnostics() const { return diag_; }

    // ── Logging ──────────────────────────────────────────────────

    /// Set the log callback. The callback receives structured LogEntry data.
    /// Safe to call at any time. Pass nullptr to disable.
    void set_log_callback(LogCallback cb, void* ctx) {
        logger_.set_callback(cb, ctx);
    }

    /// Read-only access to the logger (for advanced use / testing).
    const Logger<Config>& logger() const { return logger_; }

    // ── Diagnostics Service (§10) ───────────────────────────────

    /// Enable the built-in diagnostics service (0xFFFE).
    /// Registers the service with SD auto-offer so desktop scanners
    /// can discover and query this device.
    /// @param auth_required  When true, requests to the diagnostics service
    ///                       must carry a valid HMAC (recommended for
    ///                       state-changing methods like DIAG_CLEAR_DTCS).
    [[nodiscard]] bool enable_diagnostics(uint32_t now_ms, bool auth_required = false) {
        if (diag_enabled_) return true; // idempotent
        diag_service_.init(&dtc_store_, &diag_, &dispatcher_,
                           client_id_, &uptime_ms_);
        if (!register_service(DIAG_SERVICE_ID, diag_service_, 1, 0,
                              auth_required))
            return false;
        if (!offer_service(DIAG_SERVICE_ID, Config::OfferTtlSeconds, now_ms)) {
            // Roll back registration on failure to keep state consistent.
            unregister_service(DIAG_SERVICE_ID);
            return false;
        }
        diag_enabled_ = true;
        return true;
    }

    /// Report a DTC (application-level error code).
    [[nodiscard]] bool report_dtc(uint16_t code, DtcSeverity severity, uint32_t now_ms) {
        if constexpr (Config::MaxDtcs == 0) {
            return false;
        } else {
            bool ok = dtc_store_.report(code, severity, now_ms);
            if (!ok) diag_.increment(DiagnosticCounter::DroppedMessages);
            return ok;
        }
    }

    /// Clear a single DTC by code.
    bool clear_dtc(uint16_t code) { return dtc_store_.clear(code); }

    /// Clear all DTCs.
    void clear_all_dtcs() { dtc_store_.clear_all(); }

    /// Read-only access to the DTC store.
    const DtcStore<Config>& dtc_store() const { return dtc_store_; }

    // ── Component accessors (for advanced use) ──────────────────

    MethodDispatcher<Config>& dispatcher() { return dispatcher_; }
    EventManager<Config>&     event_manager() { return event_manager_; }
    ServiceDiscovery<Config>& service_discovery() { return sd_; }
    RequestTracker<Config>&   request_tracker() { return request_tracker_; }

private:
    TransportImpl&             transport_;
    uint16_t                   client_id_;
    Addr                       local_addr_{};

    Logger<Config>             logger_;
    E2EProtection<Config>      e2e_;
    uint8_t                    sd_seq_  = 0;  ///< Separate sequence counter for SD-only messages.
    MessageAuthenticator<Config> authenticator_;
    DiagnosticCounters         diag_;
    DtcStore<Config>           dtc_store_;
    DiagnosticsService<Config> diag_service_;
    bool                       diag_enabled_ = false;
    uint32_t                   uptime_ms_     = 0;
    uint32_t                   uptime_epoch_ms_ = 0;
    bool                       uptime_started_ = false;
    ServiceDiscovery<Config>   sd_;
    MethodDispatcher<Config>   dispatcher_;
    EventManager<Config>       event_manager_;
    RequestTracker<Config>     request_tracker_;

    uint8_t tx_buffer_[MAX_MSG_SIZE]{};

    // Response buffer for dispatch
    uint8_t response_buffer_[Config::MaxPayloadSize]{};

    // Event handler table (consumer side)
    static constexpr std::size_t MAX_EVENT_HANDLERS =
        Config::MaxKnownServices * Config::MaxEvents;
    std::array<EventHandlerEntry, MAX_EVENT_HANDLERS> event_handlers_{};
    std::size_t event_handler_count_ = 0;

    // ── Receive validation pipeline (§7.4) ──────────────────────

    void validate_and_dispatch(const Addr& source,
                               const uint8_t* data, std::size_t length,
                               uint32_t now_ms)
    {
        // Step 1: Minimum size check
        if (length < MIN_MESSAGE_SIZE) {
            diag_.increment(DiagnosticCounter::DroppedMessages, nullptr);
            logger_.warn(LogCategory::Validation, "min_size_fail",
                         0, 0, 0, static_cast<uint32_t>(length));
            return;
        }

        // Step 2: CRC-16
        if (!crc16_verify(data, length)) {
            diag_.increment(DiagnosticCounter::CrcErrors,
                            length >= HEADER_SIZE ? data : nullptr);
            logger_.error(LogCategory::Validation, "crc_fail",
                          0, 0, 0, static_cast<uint32_t>(length));
            return;
        }

        // Deserialize header
        MessageHeader hdr = MessageHeader::deserialize(data);

        // Step 3: Version
        if (hdr.version != PROTOCOL_VERSION) {
            diag_.increment(DiagnosticCounter::VersionMismatches, data);
            logger_.warn(LogCategory::Validation, "version_mismatch",
                         hdr.service_id, hdr.method_event_id, hdr.client_id,
                         hdr.version);
            return;
        }

        // Step 4: Payload length
        if (hdr.payload_length > Config::MaxPayloadSize) {
            diag_.increment(DiagnosticCounter::OversizedPayloads, data);
            logger_.warn(LogCategory::Validation, "oversized_payload",
                         hdr.service_id, hdr.method_event_id, hdr.client_id,
                         hdr.payload_length);
            return;
        }

        // Verify total message size is consistent
        std::size_t expected_size = HEADER_SIZE + hdr.payload_length
            + (hdr.has_auth() ? HMAC_SIZE : 0) + CRC_SIZE;
        if (length < expected_size) {
            diag_.increment(DiagnosticCounter::DroppedMessages, data);
            logger_.warn(LogCategory::Validation, "size_mismatch",
                         hdr.service_id, hdr.method_event_id, hdr.client_id,
                         static_cast<uint32_t>(expected_size));
            return;
        }

        // Step 5: Known message type
        if (!is_valid_message_type(hdr.message_type)) {
            diag_.increment(DiagnosticCounter::UnknownMessageTypes, data);
            logger_.warn(LogCategory::Validation, "unknown_msg_type",
                         hdr.service_id, hdr.method_event_id, hdr.client_id,
                         hdr.message_type);
            return;
        }

        // Step 6: Type/ID consistency
        // SD messages use method IDs (bit 15 = 0) and are REQUEST_NO_RETURN.
        // For SD_SUBSCRIBE_ACK the response also carries method IDs.
        if (!hdr.validate_type_id_consistency()) {
            diag_.increment(DiagnosticCounter::TypeIdMismatches, data);
            logger_.warn(LogCategory::Validation, "type_id_mismatch",
                         hdr.service_id, hdr.method_event_id, hdr.client_id,
                         hdr.message_type);
            return;
        }

        // Step 7: Client ID validation
        if (!hdr.validate_client_id()) {
            diag_.increment(DiagnosticCounter::DroppedMessages, data);
            logger_.warn(LogCategory::Validation, "client_id_invalid",
                         hdr.service_id, hdr.method_event_id, hdr.client_id, 0);
            return;
        }

        // Step 8: Sequence counter
        // SD messages are broadcasts — lossy by nature and already protected by
        // their own session-ID / reboot-detection mechanism.  Running them
        // through the per-peer unicast sequence check causes false StaleMessages
        // whenever a multicast OfferService or FindService packet is dropped by
        // the WiFi router, which contaminates the sequence state for subsequent
        // unicast method calls and event notifications.
        if (hdr.service_id != SD_SERVICE_ID) {
            auto seq_result = e2e_.validate_sequence(source, hdr.sequence_counter);
            switch (seq_result) {
                case SeqResult::Duplicate:
                    diag_.increment(DiagnosticCounter::DuplicateMessages, data);
                    logger_.warn(LogCategory::Validation, "seq_duplicate",
                                 hdr.service_id, hdr.method_event_id,
                                 hdr.client_id, hdr.sequence_counter);
                    return;
                case SeqResult::Stale:
                    diag_.increment(DiagnosticCounter::StaleMessages, data);
                    logger_.warn(LogCategory::Validation, "seq_stale",
                                 hdr.service_id, hdr.method_event_id,
                                 hdr.client_id, hdr.sequence_counter);
                    return;
                case SeqResult::Accept:
                case SeqResult::FirstSeen:
                    break; // proceed
                case SeqResult::TableFull:
                    diag_.increment(DiagnosticCounter::DroppedMessages, data);
                    break; // still process (§7.2: accept without validation)
            }
        }

        // Payload pointer
        const uint8_t* payload = data + HEADER_SIZE;

        // Step 9: HMAC verification
        if (hdr.has_auth()) {
            // HMAC is between payload and CRC
            const uint8_t* hmac_ptr = data + HEADER_SIZE + hdr.payload_length;
            if (!authenticator_.verify(data, payload, hdr.payload_length,
                                        source, hmac_ptr)) {
                diag_.increment(DiagnosticCounter::AuthFailures, data);
                logger_.error(LogCategory::Validation, "auth_fail",
                              hdr.service_id, hdr.method_event_id,
                              hdr.client_id, 0);
                return;
            }
        } else {
            // Check if the target service requires auth
            if (hdr.service_id != SD_SERVICE_ID) {
                const ServiceEntry* se = dispatcher_.find(hdr.service_id);
                if (se && se->auth_required) {
                    diag_.increment(DiagnosticCounter::AuthFailures, data);
                    logger_.error(LogCategory::Validation, "auth_required",
                                  hdr.service_id, hdr.method_event_id,
                                  hdr.client_id, 0);
                    return;
                }
            }
        }

        // Step 10: Dispatch
        logger_.debug(LogCategory::Dispatch, "dispatch",
                      hdr.service_id, hdr.method_event_id, hdr.client_id,
                      hdr.payload_length);
        dispatch_message(source, hdr, payload, hdr.payload_length, now_ms);
    }

    // ── Message dispatch by type ────────────────────────────────

    void dispatch_message(const Addr& source, const MessageHeader& hdr,
                          const uint8_t* payload, std::size_t payload_length,
                          uint32_t now_ms)
    {
        auto mt = static_cast<MessageType>(hdr.message_type);

        // SD messages
        if (hdr.service_id == SD_SERVICE_ID) {
            handle_sd_message(source, hdr, payload, payload_length, now_ms);
            return;
        }

        switch (mt) {
            case MessageType::REQUEST:
                handle_request(source, hdr, payload, payload_length);
                break;
            case MessageType::REQUEST_NO_RETURN:
                handle_fire_and_forget(hdr, payload, payload_length);
                break;
            case MessageType::RESPONSE:
                handle_response(hdr, payload, payload_length);
                break;
            case MessageType::ERROR:
                handle_error(hdr, payload, payload_length);
                break;
            case MessageType::NOTIFICATION:
                handle_notification(hdr, payload, payload_length);
                break;
        }
    }

    // ── Handler: REQUEST (§5.1) ─────────────────────────────────

    void handle_request(const Addr& source, const MessageHeader& hdr,
                        const uint8_t* payload, std::size_t payload_length)
    {
        logger_.info(LogCategory::Dispatch, "request_rx",
                     hdr.service_id, hdr.method_event_id, hdr.client_id,
                     hdr.request_id);

        std::size_t response_length = Config::MaxPayloadSize;
        ReturnCode rc = dispatcher_.dispatch(
            hdr.service_id, hdr.method_event_id,
            payload, payload_length,
            response_buffer_, response_length);

        // Build response/error
        bool is_error = (rc != ReturnCode::E_OK);
        bool auth = should_auth_outgoing(source);

        MessageHeader resp_hdr{};
        resp_hdr.version          = PROTOCOL_VERSION;
        resp_hdr.message_type     = is_error
            ? static_cast<uint8_t>(MessageType::ERROR)
            : static_cast<uint8_t>(MessageType::RESPONSE);
        resp_hdr.return_code      = static_cast<uint8_t>(rc);
        resp_hdr.flags            = auth ? FLAG_AUTH : uint8_t(0);
        resp_hdr.service_id       = hdr.service_id;
        resp_hdr.method_event_id  = hdr.method_event_id;
        resp_hdr.client_id        = hdr.client_id;
        resp_hdr.sequence_counter = e2e_.next_sequence();
        resp_hdr.request_id       = hdr.request_id;
        resp_hdr.payload_length   = is_error ? 0 : static_cast<uint32_t>(response_length);

        const uint8_t* resp_payload = is_error ? nullptr : response_buffer_;
        std::size_t resp_payload_len = is_error ? 0 : response_length;
        std::size_t total = build_message(resp_hdr, resp_payload, resp_payload_len,
                                          auth, source);
        if (!transport_.send(source, tx_buffer_, total)) {
            diag_.increment(DiagnosticCounter::DroppedMessages);            logger_.warn(LogCategory::Transport, "response_send_fail",
                         hdr.service_id, hdr.method_event_id, hdr.client_id,
                         hdr.request_id);
        } else {
            logger_.info(LogCategory::Dispatch, "response_tx",
                         hdr.service_id, hdr.method_event_id, hdr.client_id,
                         static_cast<uint32_t>(rc));        }
    }

    // ── Handler: REQUEST_NO_RETURN (§5.2) ───────────────────────

    void handle_fire_and_forget(const MessageHeader& hdr,
                                const uint8_t* payload,
                                std::size_t payload_length)
    {
        const ServiceEntry* se = dispatcher_.find(hdr.service_id);
        if (!se) {
            diag_.increment(DiagnosticCounter::DroppedMessages);
            logger_.debug(LogCategory::Dispatch, "fnf_unknown_svc",
                          hdr.service_id, hdr.method_event_id, hdr.client_id, 0);
            return;
        }
        if (!se->is_ready_fn(se->context)) {
            logger_.debug(LogCategory::Dispatch, "fnf_not_ready",
                          hdr.service_id, hdr.method_event_id, hdr.client_id, 0);
            return;
        }
        logger_.debug(LogCategory::Dispatch, "fnf_rx",
                      hdr.service_id, hdr.method_event_id, hdr.client_id,
                      static_cast<uint32_t>(payload_length));

        std::size_t dummy_len = 0;
        se->on_request_fn(se->context, hdr.method_event_id,
                          payload, payload_length,
                          nullptr, dummy_len);
        // No response sent
    }

    // ── Handler: RESPONSE (§5.1) ────────────────────────────────

    void handle_response(const MessageHeader& hdr,
                         const uint8_t* payload, std::size_t payload_length)
    {
        logger_.debug(LogCategory::Requests, "response_rx",
                      hdr.service_id, hdr.method_event_id, hdr.client_id,
                      hdr.request_id);
        request_tracker_.complete(hdr.request_id,
                                 static_cast<ReturnCode>(hdr.return_code),
                                 payload, payload_length);
    }

    // ── Handler: ERROR ──────────────────────────────────────────

    void handle_error(const MessageHeader& hdr,
                      const uint8_t* payload, std::size_t payload_length)
    {
        logger_.warn(LogCategory::Requests, "error_rx",
                     hdr.service_id, hdr.method_event_id, hdr.client_id,
                     static_cast<uint32_t>(hdr.return_code));
        request_tracker_.complete(hdr.request_id,
                                 static_cast<ReturnCode>(hdr.return_code),
                                 payload, payload_length);
    }

    // ── Handler: NOTIFICATION (§6.2) ────────────────────────────

    void handle_notification(const MessageHeader& hdr,
                             const uint8_t* payload,
                             std::size_t payload_length)
    {
        const EventHandlerEntry* eh = find_event_handler(hdr.service_id,
                                                          hdr.method_event_id);
        if (eh && eh->on_event_fn) {
            logger_.debug(LogCategory::Events, "notification_rx",
                          hdr.service_id, hdr.method_event_id, hdr.client_id,
                          static_cast<uint32_t>(payload_length));
            eh->on_event_fn(eh->context, hdr.service_id, hdr.method_event_id,
                            payload, payload_length);
        }
    }

    // ── SD message handling (§4) ────────────────────────────────

    void handle_sd_message(const Addr& source, const MessageHeader& hdr,
                           const uint8_t* payload, std::size_t payload_length,
                           uint32_t now_ms)
    {
        auto sd_op = static_cast<SdMethod>(hdr.method_event_id);
        switch (sd_op) {
            case SdMethod::SD_OFFER_SERVICE: {
                uint16_t sid; uint8_t major, minor; uint16_t ttl;
                uint16_t session_id;
                Addr provider{};
                if (sd_payload::deserialize_offer<Config>(
                        payload, payload_length, sid, major, minor, ttl,
                        session_id, provider)) {
                    logger_.debug(LogCategory::ServiceDiscovery, "offer_rx",
                                  sid, 0, hdr.client_id, ttl);
                    // Check for reboot before handling (to reset E2E state)
                    if (sd_.detect_reboot(sid, session_id)) {
                        e2e_.reset_peer(provider);
                    }
                    sd_.handle_offer(sid, major, ttl, session_id, provider, now_ms);
                }
                break;
            }
            case SdMethod::SD_FIND_SERVICE: {
                uint16_t sid;
                if (sd_payload::deserialize_find(payload, payload_length, sid)) {
                    logger_.debug(LogCategory::ServiceDiscovery, "find_rx",
                                  sid, 0, hdr.client_id, 0);
                    // Treat an incoming SD_FIND as a reboot signal for the sender.
                    // A live consumer that hasn't restarted has no reason to
                    // re-issue SD_FIND for a service it already tracks, so clearing
                    // the E2E peer state here lets the restarted consumer's fresh
                    // (small) sequence counters be accepted instead of being
                    // rejected as Stale.  reset_peer() is a no-op when the address
                    // is not yet tracked, so this is safe for first-time finders.
                    // See §4.7 and §7.2.
                    e2e_.reset_peer(source);
                    sd_.handle_find(sid, source,
                        [this](const Addr& dest, const uint8_t* msg, std::size_t len) {
                            send_sd_unicast(dest, msg, len);
                        });
                }
                break;
            }
            case SdMethod::SD_SUBSCRIBE_EVENT: {
                uint16_t sid, eid; uint16_t ttl;
                if (sd_payload::deserialize_subscribe(
                        payload, payload_length, sid, eid, ttl)) {
                    logger_.debug(LogCategory::Events, "subscribe_rx",
                                  sid, eid, hdr.client_id, ttl);
                    handle_subscribe_request(source, hdr, sid, eid, ttl, now_ms);
                }
                break;
            }
            case SdMethod::SD_SUBSCRIBE_ACK: {
                uint16_t sid, eid; uint16_t granted_ttl;
                if (sd_payload::deserialize_subscribe(
                        payload, payload_length, sid, eid, granted_ttl)) {
                    logger_.debug(LogCategory::Events, "subscribe_ack_rx",
                                  sid, eid, hdr.client_id,
                                  static_cast<uint32_t>(hdr.return_code));
                    sd_.handle_subscribe_ack(
                        sid, eid,
                        static_cast<ReturnCode>(hdr.return_code),
                        granted_ttl);
                }
                break;
            }
            case SdMethod::SD_UNSUBSCRIBE: {
                uint16_t sid, eid; uint16_t ttl;
                if (sd_payload::deserialize_subscribe(
                        payload, payload_length, sid, eid, ttl)) {
                    logger_.debug(LogCategory::Events, "unsubscribe_rx",
                                  sid, eid, hdr.client_id, 0);
                    event_manager_.unsubscribe(sid, eid, hdr.client_id);
                }
                break;
            }
        }
    }

    /// Provider-side: handle incoming SD_SUBSCRIBE_EVENT.
    void handle_subscribe_request(const Addr& source, const MessageHeader& hdr,
                                  uint16_t service_id, uint16_t event_id,
                                  uint16_t ttl_seconds, uint32_t now_ms)
    {
        ReturnCode result = event_manager_.subscribe(
            service_id, event_id, hdr.client_id, source,
            ttl_seconds, now_ms);

        // Determine granted TTL for the ACK
        uint16_t granted_ttl = 0;
        if (result == ReturnCode::E_OK) {
            granted_ttl = (ttl_seconds > 0) ? ttl_seconds : Config::SubscriptionTtlSeconds;
        }

        // Send SD_SUBSCRIBE_ACK
        uint8_t payload[SD_SUBSCRIBE_PAYLOAD_SIZE];
        sd_payload::serialize_subscribe(payload, service_id, event_id, granted_ttl);

        MessageHeader ack_hdr{};
        ack_hdr.version          = PROTOCOL_VERSION;
        ack_hdr.message_type     = static_cast<uint8_t>(MessageType::REQUEST_NO_RETURN);
        ack_hdr.return_code      = static_cast<uint8_t>(result);
        ack_hdr.flags            = 0;
        ack_hdr.service_id       = SD_SERVICE_ID;
        ack_hdr.method_event_id  = static_cast<uint16_t>(SdMethod::SD_SUBSCRIBE_ACK);
        ack_hdr.client_id        = client_id_;
        ack_hdr.sequence_counter = sd_seq_++;
        ack_hdr.request_id       = 0;
        ack_hdr.payload_length   = SD_SUBSCRIBE_PAYLOAD_SIZE;
        ack_hdr.serialize(tx_buffer_);
        std::memcpy(tx_buffer_ + MessageHeader::SIZE, payload, SD_SUBSCRIBE_PAYLOAD_SIZE);
        std::size_t total = MessageHeader::SIZE + SD_SUBSCRIBE_PAYLOAD_SIZE;
        crc16_append(tx_buffer_, total);
        total += CRC_SIZE;

        if (!transport_.send(source, tx_buffer_, total)) {
            diag_.increment(DiagnosticCounter::DroppedMessages);
            logger_.warn(LogCategory::Transport, "sub_ack_send_fail",
                         service_id, event_id, hdr.client_id, 0);
        } else {
            logger_.debug(LogCategory::Events, "subscribe_ack_tx",
                          service_id, event_id, hdr.client_id,
                          static_cast<uint32_t>(result));
        }
    }

    // ── Message building ────────────────────────────────────────

    /// Internal: allocate a request ID, build, and send to a known target.
    std::optional<uint32_t> request_impl(const Addr& target,
                                         uint16_t service_id,
                                         uint16_t method_id,
                                         const uint8_t* payload,
                                         std::size_t payload_length,
                                         RequestCallback callback,
                                         void* user_ctx,
                                         uint32_t timeout_ms,
                                         uint32_t now_ms)
    {
        auto rid = request_tracker_.allocate(service_id, method_id,
                                             timeout_ms, now_ms,
                                             callback, user_ctx);
        if (!rid) return std::nullopt; // table full

        bool auth = should_auth_outgoing(target);
        MessageHeader hdr = make_request_header(service_id, method_id,
                                                 payload_length, *rid, auth);
        hdr.sequence_counter = e2e_.next_sequence();
        std::size_t total = build_message(hdr, payload, payload_length, auth, target);
        if (!transport_.send(target, tx_buffer_, total)) {
            request_tracker_.complete(*rid, ReturnCode::E_NOT_OK, nullptr, 0);
            diag_.increment(DiagnosticCounter::DroppedMessages);
            logger_.warn(LogCategory::Transport, "request_send_fail",
                         service_id, method_id, client_id_,
                         *rid);
            return std::nullopt;
        }
        logger_.debug(LogCategory::Requests, "request_tx",
                      service_id, method_id, client_id_, *rid);
        return rid;
    }

    /// Build a complete message in tx_buffer_. Returns total byte count.
    std::size_t build_message(const MessageHeader& hdr,
                              const uint8_t* payload,
                              std::size_t payload_length,
                              bool auth,
                              const Addr& peer)
    {
        // Bounds check — prevent buffer overflow
        if (payload_length > Config::MaxPayloadSize) return 0;

        // Header
        MessageHeader mutable_hdr = hdr;
        mutable_hdr.serialize(tx_buffer_);

        // Payload
        if (payload && payload_length > 0) {
            std::memcpy(tx_buffer_ + MessageHeader::SIZE, payload, payload_length);
        }

        std::size_t offset = MessageHeader::SIZE + payload_length;

        // HMAC (if AUTH)
        if (auth) {
            uint8_t hmac_out[HMAC_SIZE]{};
            authenticator_.compute(tx_buffer_, tx_buffer_ + MessageHeader::SIZE,
                                   payload_length, peer, hmac_out);
            std::memcpy(tx_buffer_ + offset, hmac_out, HMAC_SIZE);
            offset += HMAC_SIZE;
        }

        // CRC-16
        crc16_append(tx_buffer_, offset);
        offset += CRC_SIZE;

        return offset;
    }

    /// Build header for a REQUEST message.
    MessageHeader make_request_header(uint16_t service_id, uint16_t method_id,
                                       std::size_t payload_length,
                                       uint32_t request_id, bool auth) const
    {
        MessageHeader hdr{};
        hdr.version          = PROTOCOL_VERSION;
        hdr.message_type     = static_cast<uint8_t>(MessageType::REQUEST);
        hdr.return_code      = 0;
        hdr.flags            = auth ? FLAG_AUTH : uint8_t(0);
        hdr.service_id       = service_id;
        hdr.method_event_id  = method_id;
        hdr.client_id        = client_id_;
        hdr.sequence_counter = 0; // will be set in build
        hdr.request_id       = request_id;
        hdr.payload_length   = static_cast<uint32_t>(payload_length);
        return hdr;
    }

    // ── SD transport helpers ────────────────────────────────────

    /// Wrap an SD message (header+payload assembled by SD) with seq + CRC and send.
    void send_sd_broadcast(const uint8_t* sd_msg, std::size_t sd_len) {
        if (sd_len + CRC_SIZE > MAX_MSG_SIZE) return;
        std::memcpy(tx_buffer_, sd_msg, sd_len);
        // Use a dedicated SD sequence counter so SD broadcasts do NOT advance
        // the shared unicast tx_seq_.  This prevents gaps in the per-peer
        // sequence state on the receiver when multicast packets are lost.
        tx_buffer_[10] = sd_seq_++;
        crc16_append(tx_buffer_, sd_len);
        if (!transport_.broadcast(tx_buffer_, sd_len + CRC_SIZE)) {
            diag_.increment(DiagnosticCounter::DroppedMessages);
            logger_.warn(LogCategory::Transport, "sd_broadcast_fail",
                         0, 0, client_id_, 0);
        } else {
            logger_.trace(LogCategory::ServiceDiscovery, "sd_broadcast_tx",
                          0, 0, client_id_,
                          static_cast<uint32_t>(sd_len + CRC_SIZE));
        }
    }

    void send_sd_unicast(const Addr& dest, const uint8_t* sd_msg, std::size_t sd_len) {
        if (sd_len + CRC_SIZE > MAX_MSG_SIZE) return;
        std::memcpy(tx_buffer_, sd_msg, sd_len);
        tx_buffer_[10] = sd_seq_++;
        crc16_append(tx_buffer_, sd_len);
        if (!transport_.send(dest, tx_buffer_, sd_len + CRC_SIZE)) {
            diag_.increment(DiagnosticCounter::DroppedMessages);
            logger_.warn(LogCategory::Transport, "sd_unicast_fail",
                         0, 0, client_id_, 0);
        } else {
            logger_.trace(LogCategory::ServiceDiscovery, "sd_unicast_tx",
                          0, 0, client_id_,
                          static_cast<uint32_t>(sd_len + CRC_SIZE));
        }
    }

    // ── Auth policy helpers ─────────────────────────────────────

    bool should_auth_outgoing(const Addr& peer) const {
        return authenticator_.has_key(peer);
    }

    // ── Event handler table (consumer side) ─────────────────────

    template <typename Impl>
    bool register_event_handler(uint16_t service_id, uint16_t event_id,
                                IEventHandler<Impl>& handler)
    {
        // Check duplicate
        for (std::size_t i = 0; i < event_handler_count_; ++i) {
            if (event_handlers_[i].active &&
                event_handlers_[i].service_id == service_id &&
                event_handlers_[i].event_id == event_id) {
                // Update handler
                event_handlers_[i] = make_event_handler_entry(service_id, event_id, handler);
                return true;
            }
        }
        if (event_handler_count_ >= MAX_EVENT_HANDLERS) return false;
        event_handlers_[event_handler_count_++] =
            make_event_handler_entry(service_id, event_id, handler);
        return true;
    }

    void unregister_event_handler(uint16_t service_id, uint16_t event_id) {
        for (std::size_t i = 0; i < event_handler_count_; ++i) {
            if (event_handlers_[i].active &&
                event_handlers_[i].service_id == service_id &&
                event_handlers_[i].event_id == event_id) {
                if (i != event_handler_count_ - 1) event_handlers_[i] = event_handlers_[event_handler_count_ - 1];
                event_handlers_[event_handler_count_ - 1] = EventHandlerEntry{};
                --event_handler_count_;
                return;
            }
        }
    }

    const EventHandlerEntry* find_event_handler(uint16_t service_id,
                                                 uint16_t event_id) const
    {
        for (std::size_t i = 0; i < event_handler_count_; ++i) {
            if (event_handlers_[i].active &&
                event_handlers_[i].service_id == service_id &&
                event_handlers_[i].event_id == event_id) {
                return &event_handlers_[i];
            }
        }
        return nullptr;
    }
};

} // namespace sero
