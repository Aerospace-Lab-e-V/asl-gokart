#pragma once
/// @file service_discovery.hpp
/// SD state machines, TTL management, retry logic, payload serde (§4).

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "sero/core/types.hpp"
#include "sero/core/message_header.hpp"
#include "sero/core/log.hpp"

namespace sero {

// ── SD payload sizes (§4.3) ─────────────────────────────────────────

template <typename Config>
inline constexpr std::size_t SD_OFFER_PAYLOAD_SIZE =
    8 + Config::TransportAddressSize;

inline constexpr std::size_t SD_FIND_PAYLOAD_SIZE = 4;
inline constexpr std::size_t SD_SUBSCRIBE_PAYLOAD_SIZE = 8;

// ── SD payload helpers ──────────────────────────────────────────────

namespace sd_payload {

/// Serialize SD_OFFER_SERVICE payload.
template <typename Config>
inline void serialize_offer(uint8_t* out,
                            uint16_t offered_service_id,
                            uint8_t major_version,
                            uint8_t minor_version,
                            uint16_t ttl_seconds,
                            uint16_t session_id,
                            const Address<Config>& provider_addr)
{
    MessageHeader::write_u16(out, offered_service_id);
    out[2] = major_version;
    out[3] = minor_version;
    MessageHeader::write_u16(out + 4, ttl_seconds);
    MessageHeader::write_u16(out + 6, session_id); // reboot detection (§4.7)
    std::memcpy(out + 8, provider_addr.data(), Config::TransportAddressSize);
}

/// Deserialize SD_OFFER_SERVICE payload.
template <typename Config>
inline bool deserialize_offer(const uint8_t* data, std::size_t len,
                              uint16_t& offered_service_id,
                              uint8_t& major_version,
                              uint8_t& minor_version,
                              uint16_t& ttl_seconds,
                              uint16_t& session_id,
                              Address<Config>& provider_addr)
{
    if (len < SD_OFFER_PAYLOAD_SIZE<Config>) return false;
    offered_service_id = MessageHeader::read_u16(data);
    major_version = data[2];
    minor_version = data[3];
    ttl_seconds = MessageHeader::read_u16(data + 4);
    session_id = MessageHeader::read_u16(data + 6);
    std::memcpy(provider_addr.data(), data + 8, Config::TransportAddressSize);
    return true;
}

/// Serialize SD_FIND_SERVICE payload.
inline void serialize_find(uint8_t* out, uint16_t requested_service_id) {
    MessageHeader::write_u16(out, requested_service_id);
    out[2] = 0; out[3] = 0; // reserved
}

/// Deserialize SD_FIND_SERVICE payload.
inline bool deserialize_find(const uint8_t* data, std::size_t len,
                             uint16_t& requested_service_id)
{
    if (len < SD_FIND_PAYLOAD_SIZE) return false;
    requested_service_id = MessageHeader::read_u16(data);
    return true;
}

/// Serialize SD_SUBSCRIBE_EVENT / SD_SUBSCRIBE_ACK / SD_UNSUBSCRIBE payload.
inline void serialize_subscribe(uint8_t* out,
                                uint16_t target_service_id,
                                uint16_t target_event_id,
                                uint16_t ttl_seconds)
{
    MessageHeader::write_u16(out, target_service_id);
    MessageHeader::write_u16(out + 2, target_event_id);
    MessageHeader::write_u16(out + 4, ttl_seconds);
    out[6] = 0; out[7] = 0; // reserved
}

/// Deserialize subscribe-family payload.
inline bool deserialize_subscribe(const uint8_t* data, std::size_t len,
                                  uint16_t& target_service_id,
                                  uint16_t& target_event_id,
                                  uint16_t& ttl_seconds)
{
    if (len < SD_SUBSCRIBE_PAYLOAD_SIZE) return false;
    target_service_id = MessageHeader::read_u16(data);
    target_event_id   = MessageHeader::read_u16(data + 2);
    ttl_seconds       = MessageHeader::read_u16(data + 4);
    return true;
}

} // namespace sd_payload

// ── Application callbacks for SD events ────────────────────────────

template <typename Config>
struct SdCallbacks {
    using Addr = Address<Config>;

    /// Called when a service is found (consumer side).
    void (*on_service_found)(uint16_t service_id, const Addr& provider_addr, void* ctx) = nullptr;
    void* service_found_ctx = nullptr;

    /// Called when a service is lost (TTL expired, consumer side).
    void (*on_service_lost)(uint16_t service_id, void* ctx) = nullptr;
    void* service_lost_ctx = nullptr;

    /// Called when a subscription ACK is received (consumer side).
    void (*on_subscription_ack)(uint16_t service_id, uint16_t event_id,
                                ReturnCode result, uint16_t granted_ttl,
                                void* ctx) = nullptr;
    void* subscription_ack_ctx = nullptr;
};

// ── Provider SD State Machine (§4.5) ───────────────────────────────

template <typename Config>
class ServiceDiscovery {
public:
    using Addr = Address<Config>;

    ServiceDiscovery() = default;

    void set_local_address(const Addr& addr) { local_addr_ = addr; }
    void set_client_id(uint16_t cid) { client_id_ = cid; }
    void set_logger(Logger<Config>* logger) { logger_ = logger; }

    SdCallbacks<Config>& callbacks() { return callbacks_; }

    // ── Provider API ────────────────────────────────────────────

    /// Start offering a service. Broadcasts immediately.
    bool offer(uint16_t service_id, uint8_t major, uint8_t minor,
               uint16_t ttl_seconds, uint32_t now_ms)
    {
        // Update existing entry or find new slot
        ProviderEntry* pe = find_provider(service_id);
        if (!pe) {
            if (provider_count_ >= Config::MaxServices) return false;
            pe = &providers_[provider_count_++];
        }
        pe->service_id    = service_id;
        pe->major_version = major;
        pe->minor_version = minor;
        pe->ttl_seconds   = (ttl_seconds > 0) ? ttl_seconds : Config::OfferTtlSeconds;
        pe->session_id    = generate_session_id(service_id, now_ms);
        pe->state         = ProviderState::OFFERED;
        pe->last_offer_ms = now_ms;
        pe->active        = true;
        pe->needs_broadcast = true; // will be sent in process_offers
        if (logger_) logger_->info(LogCategory::ServiceDiscovery, "offer_start",
                                    service_id, 0, client_id_, ttl_seconds);
        return true;
    }

    /// Stop offering a service (§4.5).
    void stop_offer(uint16_t service_id) {
        ProviderEntry* pe = find_provider(service_id);
        if (pe) {
            pe->state  = ProviderState::NOT_OFFERED;
            pe->active = false;
            if (logger_) logger_->info(LogCategory::ServiceDiscovery, "offer_stop",
                                        service_id, 0, client_id_, 0);
        }
    }

    // ── Consumer API ────────────────────────────────────────────

    /// Start searching for a service (§4.6).
    bool find(uint16_t service_id, uint8_t expected_major, uint32_t now_ms) {
        ConsumerEntry* ce = find_consumer(service_id);
        if (!ce) {
            if (consumer_count_ >= Config::MaxKnownServices) return false;
            ce = &consumers_[consumer_count_++];
        }
        ce->service_id      = service_id;
        ce->expected_major  = expected_major;
        ce->state           = ConsumerState::SEARCHING;
        ce->retry_count     = 0;
        ce->next_retry_ms   = now_ms; // send immediately
        ce->active          = true;
        ce->ttl_expiry_ms   = 0;
        if (logger_) logger_->info(LogCategory::ServiceDiscovery, "find_start",
                                    service_id, 0, client_id_, expected_major);
        return true;
    }

    /// Subscribe to an event on a found service (consumer side).
    /// Must be called after service is in FOUND state.
    bool subscribe_event(uint16_t service_id, uint16_t event_id,
                         uint16_t ttl_seconds, uint32_t now_ms)
    {
        // Find existing or allocate new subscription tracking entry.
        SubTracker* st = find_sub_tracker(service_id, event_id);
        if (!st) {
            if (sub_tracker_count_ >= MAX_SUB_TRACKERS) return false;
            st = &sub_trackers_[sub_tracker_count_++];
        }
        st->service_id      = service_id;
        st->event_id        = event_id;
        st->requested_ttl   = ttl_seconds;
        st->granted_ttl     = 0;
        st->active          = true;
        st->app_registered  = true;
        st->needs_send      = true;
        st->last_sent_ms    = now_ms;
        return true;
    }

    /// Unsubscribe from an event.
    bool unsubscribe_event(uint16_t service_id, uint16_t event_id) {
        SubTracker* st = find_sub_tracker(service_id, event_id);
        if (!st) return false;
        st->app_registered    = false; // app no longer wants this — never reactivate on reconnect
        st->needs_unsubscribe = true;
        return true;
    }

    // ── Process cycle methods (called from Runtime::process) ────

    /// Re-broadcast offers at TTL/2 (§4.4). Also sends initial offers.
    /// broadcast_fn: bool(const uint8_t* data, size_t len)
    /// unicast_fn  : bool(const Addr& dest, const uint8_t* data, size_t len)
    template <typename BroadcastFn>
    void process_offers(uint32_t now_ms, BroadcastFn&& broadcast_fn) {
        for (std::size_t i = 0; i < provider_count_; ++i) {
            auto& pe = providers_[i];
            if (pe.state != ProviderState::OFFERED) continue;

            uint32_t interval_ms = static_cast<uint32_t>(pe.ttl_seconds) * 500u; // TTL / 2
            bool should_send = pe.needs_broadcast ||
                               time_after_or_eq(now_ms, pe.last_offer_ms + interval_ms);
            if (should_send) {
                uint8_t payload[SD_OFFER_PAYLOAD_SIZE<Config>];
                sd_payload::serialize_offer<Config>(
                    payload, pe.service_id, pe.major_version, pe.minor_version,
                    pe.ttl_seconds, pe.session_id, local_addr_);

                uint8_t msg[MessageHeader::SIZE + SD_OFFER_PAYLOAD_SIZE<Config>];
                build_sd_header(msg, static_cast<uint16_t>(SdMethod::SD_OFFER_SERVICE),
                                SD_OFFER_PAYLOAD_SIZE<Config>);
                std::memcpy(msg + MessageHeader::SIZE, payload, SD_OFFER_PAYLOAD_SIZE<Config>);
                broadcast_fn(msg, sizeof(msg));
                pe.last_offer_ms = now_ms;
                pe.needs_broadcast = false;
            }
        }
    }

    /// Process consumer SD_FIND retries with exponential backoff (§4.4).
    /// broadcast_fn: same signature.
    template <typename BroadcastFn>
    void process_finds(uint32_t now_ms, BroadcastFn&& broadcast_fn) {
        for (std::size_t i = 0; i < consumer_count_; ++i) {
            auto& ce = consumers_[i];
            if (ce.state != ConsumerState::SEARCHING) continue;

            if (time_after_or_eq(now_ms, ce.next_retry_ms)) {
                // Send SD_FIND_SERVICE
                uint8_t payload[SD_FIND_PAYLOAD_SIZE];
                sd_payload::serialize_find(payload, ce.service_id);

                uint8_t msg[MessageHeader::SIZE + SD_FIND_PAYLOAD_SIZE];
                build_sd_header(msg, static_cast<uint16_t>(SdMethod::SD_FIND_SERVICE),
                                SD_FIND_PAYLOAD_SIZE);
                std::memcpy(msg + MessageHeader::SIZE, payload, SD_FIND_PAYLOAD_SIZE);
                broadcast_fn(msg, sizeof(msg));

                ++ce.retry_count;
                if (ce.retry_count > Config::SdFindRetryCount) {
                    // Retries exhausted → NOT_FOUND
                    ce.state = ConsumerState::NOT_FOUND;
                    if (logger_) logger_->warn(LogCategory::ServiceDiscovery, "find_exhausted",
                                                ce.service_id, 0, client_id_,
                                                ce.retry_count);
                    if (callbacks_.on_service_lost) {
                        callbacks_.on_service_lost(ce.service_id,
                                                   callbacks_.service_lost_ctx);
                    }
                } else {
                    // Exponential backoff + jitter
                    uint32_t delay = Config::SdFindInitialDelayMs;
                    for (uint8_t j = 0; j < ce.retry_count; ++j) {
                        delay *= Config::SdFindBackoffMultiplier;
                    }
                    // Deterministic jitter from client_id + retry_count
                    int32_t jitter = compute_jitter(ce.service_id, ce.retry_count);
                    int64_t next = static_cast<int64_t>(now_ms) + delay + jitter;
                    ce.next_retry_ms = (next > 0) ? static_cast<uint32_t>(next) : now_ms;
                }
            }
        }
    }

    /// Expire consumer service TTLs (§4.6).
    /// on_peer_expired: void(const Addr& provider_addr) — called so the
    /// runtime can reset E2E sequence state for the dead peer.
    template <typename OnPeerExpiredFn>
    void process_consumer_ttls(uint32_t now_ms, OnPeerExpiredFn&& on_peer_expired) {
        for (std::size_t i = 0; i < consumer_count_; ++i) {
            auto& ce = consumers_[i];
            if (ce.state != ConsumerState::FOUND) continue;
            if (time_after(now_ms, ce.ttl_expiry_ms)) {
                Addr expired_addr = ce.provider_addr;
                ce.state = ConsumerState::NOT_FOUND;
                ce.session_valid = false; // allow fresh session on reconnect
                if (logger_) logger_->warn(LogCategory::ServiceDiscovery, "ttl_expired",
                                            ce.service_id, 0, client_id_, 0);
                on_peer_expired(expired_addr);
                if (callbacks_.on_service_lost) {
                    callbacks_.on_service_lost(ce.service_id,
                                               callbacks_.service_lost_ctx);
                }
            }
        }
    }

    /// Process subscription renewals at granted-TTL/2.
    /// send_fn: bool(const Addr& dest, const uint8_t* data, size_t len)
    template <typename SendFn>
    void process_subscription_renewals(uint32_t now_ms, SendFn&& send_fn) {
        for (std::size_t i = 0; i < sub_tracker_count_; ++i) {
            auto& st = sub_trackers_[i];
            if (!st.active) continue;

            const ConsumerEntry* ce = find_consumer(st.service_id);
            if (!ce || ce->state != ConsumerState::FOUND) continue;

            if (st.needs_unsubscribe) {
                // Send SD_UNSUBSCRIBE
                uint8_t payload[SD_SUBSCRIBE_PAYLOAD_SIZE];
                sd_payload::serialize_subscribe(payload, st.service_id, st.event_id, 0);

                uint8_t msg[MessageHeader::SIZE + SD_SUBSCRIBE_PAYLOAD_SIZE];
                build_sd_header(msg, static_cast<uint16_t>(SdMethod::SD_UNSUBSCRIBE),
                                SD_SUBSCRIBE_PAYLOAD_SIZE);
                std::memcpy(msg + MessageHeader::SIZE, payload, SD_SUBSCRIBE_PAYLOAD_SIZE);
                send_fn(ce->provider_addr, msg, sizeof(msg));

                st.active = false;
                st.needs_unsubscribe = false;
                continue;
            }

            if (st.needs_send) {
                // Send initial SD_SUBSCRIBE_EVENT
                send_subscribe(st, ce->provider_addr, send_fn);
                st.needs_send = false;
                st.last_sent_ms = now_ms;
                continue;
            }

            // Renewal at granted TTL / 2
            if (st.granted_ttl > 0) {
                uint32_t renewal_interval = static_cast<uint32_t>(st.granted_ttl) * 500u;
                if (time_after_or_eq(now_ms, st.last_sent_ms + renewal_interval)) {
                    send_subscribe(st, ce->provider_addr, send_fn);
                    st.last_sent_ms = now_ms;
                }
            } else {
                // No ACK received yet — retry after SubscriptionTtlSeconds
                uint32_t retry_interval = static_cast<uint32_t>(Config::SubscriptionTtlSeconds) * 1000u;
                if (time_after_or_eq(now_ms, st.last_sent_ms + retry_interval)) {
                    if (st.ack_retry_count < 2) {
                        send_subscribe(st, ce->provider_addr, send_fn);
                        st.last_sent_ms = now_ms;
                        ++st.ack_retry_count;
                    } else {
                        // Retries exhausted — give up
                        st.active = false;
                    }
                }
            }
        }
    }

    // ── Incoming SD message handlers ────────────────────────────

    /// Handle incoming SD_OFFER_SERVICE (consumer side, §4.6).
    void handle_offer(uint16_t offered_service_id,
                      uint8_t major_version,
                      uint16_t ttl_seconds,
                      uint16_t session_id,
                      const Addr& provider_addr,
                      uint32_t now_ms)
    {
        if (ttl_seconds == 0) return; // §4.3: ignore offers with TTL=0

        ConsumerEntry* ce = find_consumer(offered_service_id);
        if (!ce) return; // not interested

        // Version check: ignore if major version differs
        if (major_version != ce->expected_major) return;

        uint32_t ttl_ms = static_cast<uint32_t>(ttl_seconds) * 1000u;

        // §4.7 Reboot detection: session_id changed → provider restarted
        bool reboot_detected = ce->session_valid &&
                               ce->state == ConsumerState::FOUND &&
                               ce->session_id != session_id;

        bool new_provider = (ce->state != ConsumerState::FOUND ||
                             ce->provider_addr != provider_addr);

        ce->provider_addr = provider_addr;
        ce->ttl_expiry_ms = now_ms + ttl_ms;
        ce->session_id    = session_id;
        ce->session_valid  = true;

        if (reboot_detected) {
            // Provider restarted — notify app and mark subscriptions for re-send
            if (logger_) logger_->warn(LogCategory::ServiceDiscovery, "reboot_detected",
                                        offered_service_id, 0, client_id_, session_id);
            if (callbacks_.on_service_lost) {
                callbacks_.on_service_lost(offered_service_id,
                                           callbacks_.service_lost_ctx);
            }
            ce->state = ConsumerState::FOUND;
            if (callbacks_.on_service_found) {
                callbacks_.on_service_found(offered_service_id, provider_addr,
                                            callbacks_.service_found_ctx);
            }
            // Flag all active subscriptions for this service as needing re-send
            flag_resubscribe(offered_service_id, now_ms);
            return;
        }

        if (ce->state != ConsumerState::FOUND) {
            ce->state = ConsumerState::FOUND;
            if (logger_) logger_->info(LogCategory::ServiceDiscovery, "service_found",
                                        offered_service_id, 0, client_id_, ttl_seconds);
            // Re-send any active subscriptions for this service
            flag_resubscribe(offered_service_id, now_ms);
            if (callbacks_.on_service_found) {
                callbacks_.on_service_found(offered_service_id, provider_addr,
                                            callbacks_.service_found_ctx);
            }
        } else if (new_provider) {
            // Provider change — re-subscribe to new provider
            flag_resubscribe(offered_service_id, now_ms);
            if (callbacks_.on_service_found) {
                callbacks_.on_service_found(offered_service_id, provider_addr,
                                            callbacks_.service_found_ctx);
            }
        }
    }

    /// Handle incoming SD_FIND_SERVICE (provider side, §4.4).
    /// Returns true if we should respond (caller does the unicast).
    template <typename UnicastFn>
    void handle_find(uint16_t requested_service_id,
                     const Addr& source,
                     UnicastFn&& unicast_fn)
    {
        bool wildcard = (requested_service_id == 0xFFFF);
        for (std::size_t i = 0; i < provider_count_; ++i) {
            const auto& pe = providers_[i];
            if (pe.state != ProviderState::OFFERED) continue;
            if (wildcard || pe.service_id == requested_service_id) {
                // Send unicast offer
                uint8_t payload[SD_OFFER_PAYLOAD_SIZE<Config>];
                sd_payload::serialize_offer<Config>(
                    payload, pe.service_id, pe.major_version, pe.minor_version,
                    pe.ttl_seconds, pe.session_id, local_addr_);

                uint8_t msg[MessageHeader::SIZE + SD_OFFER_PAYLOAD_SIZE<Config>];
                build_sd_header(msg, static_cast<uint16_t>(SdMethod::SD_OFFER_SERVICE),
                                SD_OFFER_PAYLOAD_SIZE<Config>);
                std::memcpy(msg + MessageHeader::SIZE, payload, SD_OFFER_PAYLOAD_SIZE<Config>);
                unicast_fn(source, msg, sizeof(msg));
            }
        }
    }

    /// Handle incoming SD_SUBSCRIBE_ACK (consumer side, §6.1).
    void handle_subscribe_ack(uint16_t service_id, uint16_t event_id,
                              ReturnCode result, uint16_t granted_ttl)
    {
        SubTracker* st = find_sub_tracker(service_id, event_id);
        if (st && st->active) {
            if (result == ReturnCode::E_OK) {
                st->granted_ttl = granted_ttl;
                if (logger_) logger_->info(LogCategory::Events, "sub_ack_ok",
                                            service_id, event_id, client_id_,
                                            granted_ttl);
            } else {
                st->active = false; // §6.1: MUST NOT retry automatically
                if (logger_) logger_->warn(LogCategory::Events, "sub_ack_fail",
                                            service_id, event_id, client_id_,
                                            static_cast<uint32_t>(result));
            }
        }
        if (callbacks_.on_subscription_ack) {
            callbacks_.on_subscription_ack(service_id, event_id, result, granted_ttl,
                                           callbacks_.subscription_ack_ctx);
        }
    }

    // ── Query state ─────────────────────────────────────────────

    enum class ConsumerState : uint8_t { NOT_FOUND, SEARCHING, FOUND };
    enum class ProviderState : uint8_t { NOT_OFFERED, OFFERED };

    /// Get provider address for a found service (consumer side).
    bool get_provider_address(uint16_t service_id, Addr& addr_out) const {
        const ConsumerEntry* ce = find_consumer_const(service_id);
        if (ce && ce->state == ConsumerState::FOUND) {
            addr_out = ce->provider_addr;
            return true;
        }
        return false;
    }

    ConsumerState get_consumer_state(uint16_t service_id) const {
        const ConsumerEntry* ce = find_consumer_const(service_id);
        return ce ? ce->state : ConsumerState::NOT_FOUND;
    }

    /// Check if a new offer represents a provider reboot (§4.7).
    /// Read-only — does not modify state. Call before handle_offer()
    /// so the caller can reset E2E peer tracking if true.
    bool detect_reboot(uint16_t service_id, uint16_t session_id) const {
        const ConsumerEntry* ce = find_consumer_const(service_id);
        if (!ce) return false;
        return ce->session_valid &&
               ce->state == ConsumerState::FOUND &&
               ce->session_id != session_id;
    }

private:
    static constexpr std::size_t MAX_SUB_TRACKERS =
        Config::MaxKnownServices * Config::MaxEvents;

    struct ProviderEntry {
        uint16_t      service_id    = 0;
        uint8_t       major_version = 0;
        uint8_t       minor_version = 0;
        uint16_t      ttl_seconds   = 0;
        uint16_t      session_id    = 0; // reboot detection (§4.7)
        ProviderState state         = ProviderState::NOT_OFFERED;
        uint32_t      last_offer_ms = 0;
        bool          active        = false;
        bool          needs_broadcast = false;
    };

    struct ConsumerEntry {
        uint16_t      service_id     = 0;
        uint8_t       expected_major = 0;
        ConsumerState state          = ConsumerState::NOT_FOUND;
        Addr          provider_addr{};
        uint32_t      ttl_expiry_ms  = 0;
        uint8_t       retry_count    = 0;
        uint32_t      next_retry_ms  = 0;
        bool          active         = false;
        uint16_t      session_id     = 0;     // last-seen provider session (§4.7)
        bool          session_valid  = false;  // true once first offer received
    };

    struct SubTracker {
        uint16_t service_id        = 0;
        uint16_t event_id          = 0;
        uint16_t requested_ttl     = 0;
        uint16_t granted_ttl       = 0;
        bool     active            = false;
        bool     app_registered    = false; ///< True while the app wants this subscription.
        bool     needs_send        = false;
        bool     needs_unsubscribe = false;
        uint32_t last_sent_ms      = 0;
        uint8_t  ack_retry_count   = 0;  ///< Retries when no ACK received.
    };

    std::array<ProviderEntry, Config::MaxServices>      providers_{};
    std::size_t provider_count_ = 0;

    std::array<ConsumerEntry, Config::MaxKnownServices> consumers_{};
    std::size_t consumer_count_ = 0;

    std::array<SubTracker, MAX_SUB_TRACKERS>            sub_trackers_{};
    std::size_t sub_tracker_count_ = 0;

    Addr       local_addr_{};
    uint16_t   client_id_ = 0;
    SdCallbacks<Config> callbacks_{};
    Logger<Config>* logger_ = nullptr;

    // ── Lookup helpers ──────────────────────────────────────────

    ProviderEntry* find_provider(uint16_t sid) {
        for (std::size_t i = 0; i < provider_count_; ++i)
            if (providers_[i].service_id == sid) return &providers_[i];
        return nullptr;
    }

    ConsumerEntry* find_consumer(uint16_t sid) {
        for (std::size_t i = 0; i < consumer_count_; ++i)
            if (consumers_[i].service_id == sid) return &consumers_[i];
        return nullptr;
    }

    const ConsumerEntry* find_consumer_const(uint16_t sid) const {
        for (std::size_t i = 0; i < consumer_count_; ++i)
            if (consumers_[i].service_id == sid) return &consumers_[i];
        return nullptr;
    }

    SubTracker* find_sub_tracker(uint16_t sid, uint16_t eid) {
        for (std::size_t i = 0; i < sub_tracker_count_; ++i)
            if (sub_trackers_[i].service_id == sid &&
                sub_trackers_[i].event_id == eid)
                return &sub_trackers_[i];
        return nullptr;
    }

    // ── SD header builder (used for internal SD messages) ───────

    void build_sd_header(uint8_t* out, uint16_t sd_method_id,
                         uint32_t payload_size) const
    {
        MessageHeader hdr;
        hdr.version          = PROTOCOL_VERSION;
        hdr.message_type     = static_cast<uint8_t>(MessageType::REQUEST_NO_RETURN);
        hdr.return_code      = 0;
        hdr.flags            = 0;
        hdr.service_id       = SD_SERVICE_ID;
        hdr.method_event_id  = sd_method_id;
        hdr.client_id        = client_id_;
        hdr.sequence_counter = 0; // Will be overwritten by Runtime
        hdr.reserved         = 0;
        hdr.request_id       = 0;
        hdr.payload_length   = payload_size;
        hdr.serialize(out);
    }

    /// Send a subscribe message to a provider.
    template <typename SendFn>
    void send_subscribe(const SubTracker& st, const Addr& provider_addr,
                        SendFn&& send_fn) const
    {
        uint8_t payload[SD_SUBSCRIBE_PAYLOAD_SIZE];
        sd_payload::serialize_subscribe(payload, st.service_id, st.event_id,
                                         st.requested_ttl);

        uint8_t msg[MessageHeader::SIZE + SD_SUBSCRIBE_PAYLOAD_SIZE];
        build_sd_header(msg, static_cast<uint16_t>(SdMethod::SD_SUBSCRIBE_EVENT),
                        SD_SUBSCRIBE_PAYLOAD_SIZE);
        std::memcpy(msg + MessageHeader::SIZE, payload, SD_SUBSCRIBE_PAYLOAD_SIZE);
        send_fn(provider_addr, msg, sizeof(msg));
    }

    // ── Resubscription on reboot detection (§4.7) ────────────────

    /// Flag all app-registered subscriptions for a service as needing re-send.
    /// Revives trackers whose retries were exhausted while the provider was away.
    void flag_resubscribe(uint16_t service_id, uint32_t now_ms) {
        for (std::size_t i = 0; i < sub_tracker_count_; ++i) {
            if (sub_trackers_[i].app_registered &&
                sub_trackers_[i].service_id == service_id) {
                sub_trackers_[i].active          = true;
                sub_trackers_[i].ack_retry_count = 0;
                sub_trackers_[i].needs_send      = true;
                sub_trackers_[i].granted_ttl     = 0;
                sub_trackers_[i].last_sent_ms    = now_ms;
            }
        }
    }

    // ── Session ID generation (§4.7) ───────────────────────────

    /// Generate a deterministic-but-unique session ID per boot.
    /// Uses client_id + now_ms to produce a non-zero 16-bit value.
    uint16_t generate_session_id(uint16_t service_id, uint32_t now_ms) const {
        uint32_t seed = (static_cast<uint32_t>(client_id_) << 16) |
                        static_cast<uint32_t>(service_id);
        seed ^= now_ms;
        seed = seed * 2654435761u; // Knuth multiplicative hash
        uint16_t id = static_cast<uint16_t>(seed & 0xFFFF);
        return (id == 0) ? 1 : id; // ensure non-zero
    }

    // ── Jitter (deterministic LCG from client_id, avoids <random>) ──

    int32_t compute_jitter(uint16_t service_id, uint8_t retry) const {
        uint32_t seed = (static_cast<uint32_t>(client_id_) << 16) |
                        (static_cast<uint32_t>(service_id) ^ (retry * 0x9E3779B9u));
        seed = seed * 1103515245u + 12345u;
        int32_t j = static_cast<int32_t>(seed % (2 * Config::SdFindJitterMs + 1));
        return j - static_cast<int32_t>(Config::SdFindJitterMs);
    }

    static bool time_after(uint32_t now, uint32_t target) {
        return static_cast<int32_t>(now - target) > 0;
    }
    static bool time_after_or_eq(uint32_t now, uint32_t target) {
        return static_cast<int32_t>(now - target) >= 0;
    }
};

} // namespace sero
