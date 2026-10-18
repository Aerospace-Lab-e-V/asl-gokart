#pragma once
/// @file event_manager.hpp
/// Subscriber tables, TTL eviction, and notification fan-out (§6, §10.2).

#include <array>
#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"
#include "sero/core/log.hpp"

namespace sero {

template <typename Config>
class EventManager {
public:
    using Addr = Address<Config>;

    EventManager() = default;

    void set_logger(Logger<Config>* logger) { logger_ = logger; }

    /// Register an event slot (provider side). Returns false if table full.
    bool register_event(uint16_t service_id, uint16_t event_id) {
        // Check duplicate
        for (std::size_t i = 0; i < event_count_; ++i) {
            if (events_[i].active &&
                events_[i].service_id == service_id &&
                events_[i].event_id == event_id) {
                return true; // already registered
            }
        }
        if (event_count_ >= MAX_EVENTS) {
            if (logger_) logger_->warn(LogCategory::Events, "event_table_full",
                                        service_id, event_id, 0,
                                        static_cast<uint32_t>(event_count_));
            return false;
        }
        auto& ev = events_[event_count_];
        ev.service_id  = service_id;
        ev.event_id    = event_id;
        ev.active      = true;
        ev.sub_count   = 0;
        ++event_count_;
        if (logger_) logger_->info(LogCategory::Events, "event_registered",
                                    service_id, event_id, 0, 0);
        return true;
    }

    /// Subscribe a consumer to an event. Returns E_OK or E_NOT_OK (table full).
    /// If the client is already subscribed, resets TTL (renewal, §6.3).
    ReturnCode subscribe(uint16_t service_id, uint16_t event_id,
                         uint16_t client_id, const Addr& addr,
                         uint16_t ttl_seconds, uint32_t now_ms)
    {
        EventSlot* ev = find_event(service_id, event_id);
        if (!ev) return ReturnCode::E_NOT_OK;

        uint32_t expiry = (ttl_seconds > 0)
            ? now_ms + static_cast<uint32_t>(ttl_seconds) * 1000u
            : now_ms + static_cast<uint32_t>(Config::SubscriptionTtlSeconds) * 1000u;

        // Renewal — existing subscriber resets TTL
        for (std::size_t i = 0; i < ev->sub_count; ++i) {
            if (ev->subscribers[i].client_id == client_id) {
                ev->subscribers[i].addr      = addr;
                ev->subscribers[i].expiry_ms = expiry;
                return ReturnCode::E_OK;
            }
        }

        // New subscriber
        if (ev->sub_count >= Config::MaxSubscribers) {
            if (logger_) logger_->warn(LogCategory::Events, "sub_table_full",
                                        service_id, event_id, client_id,
                                        static_cast<uint32_t>(ev->sub_count));
            return ReturnCode::E_NOT_OK; // table full
        }
        auto& s = ev->subscribers[ev->sub_count];
        s.client_id = client_id;
        s.addr      = addr;
        s.expiry_ms = expiry;
        ++ev->sub_count;
        if (logger_) logger_->info(LogCategory::Events, "subscriber_added",
                                    service_id, event_id, client_id,
                                    static_cast<uint32_t>(ev->sub_count));
        return ReturnCode::E_OK;
    }

    /// Unsubscribe a consumer.
    void unsubscribe(uint16_t service_id, uint16_t event_id, uint16_t client_id) {
        EventSlot* ev = find_event(service_id, event_id);
        if (!ev) return;
        for (std::size_t i = 0; i < ev->sub_count; ++i) {
            if (ev->subscribers[i].client_id == client_id) {
                // Compact: move last into this slot
                if (i != ev->sub_count - 1) ev->subscribers[i] = ev->subscribers[ev->sub_count - 1];
                ev->subscribers[ev->sub_count - 1] = Subscriber{};
                --ev->sub_count;
                if (logger_) logger_->info(LogCategory::Events, "subscriber_removed",
                                            service_id, event_id, client_id,
                                            static_cast<uint32_t>(ev->sub_count));
                return;
            }
        }
    }

    /// Evict expired subscriptions (§6.3). Called each process() cycle.
    void evict_expired(uint32_t now_ms) {
        for (std::size_t e = 0; e < event_count_; ++e) {
            if (!events_[e].active) continue;
            auto& ev = events_[e];
            std::size_t i = 0;
            while (i < ev.sub_count) {
                if (time_after(now_ms, ev.subscribers[i].expiry_ms)) {
                    // Expired — compact
                    if (i != ev.sub_count - 1) ev.subscribers[i] = ev.subscribers[ev.sub_count - 1];
                    ev.subscribers[ev.sub_count - 1] = Subscriber{};
                    --ev.sub_count;
                } else {
                    ++i;
                }
            }
        }
    }

    /// Fan-out notification to all active subscribers.
    /// SendFn signature: bool(const Addr& dest, const uint8_t* data, size_t len)
    template <typename BuildAndSendFn>
    void notify(uint16_t service_id, uint16_t event_id,
                BuildAndSendFn&& build_and_send) const
    {
        const EventSlot* ev = find_event_const(service_id, event_id);
        if (!ev) return;
        for (std::size_t i = 0; i < ev->sub_count; ++i) {
            build_and_send(ev->subscribers[i].addr, ev->subscribers[i].client_id);
        }
    }

    /// Check if there are any subscribers for an event.
    bool has_subscribers(uint16_t service_id, uint16_t event_id) const {
        const EventSlot* ev = find_event_const(service_id, event_id);
        return ev && ev->sub_count > 0;
    }

    /// Get the granted TTL (in seconds) for an existing subscriber, or 0 if not found.
    uint16_t get_granted_ttl(uint16_t service_id, uint16_t event_id,
                             uint16_t client_id, uint32_t now_ms) const
    {
        const EventSlot* ev = find_event_const(service_id, event_id);
        if (!ev) return 0;
        for (std::size_t i = 0; i < ev->sub_count; ++i) {
            if (ev->subscribers[i].client_id == client_id) {
                uint32_t remaining_ms = 0;
                if (ev->subscribers[i].expiry_ms > now_ms) {
                    remaining_ms = ev->subscribers[i].expiry_ms - now_ms;
                }
                return static_cast<uint16_t>(remaining_ms / 1000u);
            }
        }
        return 0;
    }

private:
    static constexpr std::size_t MAX_EVENTS = Config::MaxServices * Config::MaxEvents;

    struct Subscriber {
        uint16_t client_id = 0;
        Addr     addr{};
        uint32_t expiry_ms = 0;
    };

    struct EventSlot {
        uint16_t    service_id = 0;
        uint16_t    event_id   = 0;
        bool        active     = false;
        std::size_t sub_count  = 0;
        std::array<Subscriber, Config::MaxSubscribers> subscribers{};
    };

    std::array<EventSlot, MAX_EVENTS> events_{};
    std::size_t event_count_ = 0;
    Logger<Config>* logger_ = nullptr;

    EventSlot* find_event(uint16_t sid, uint16_t eid) {
        for (std::size_t i = 0; i < event_count_; ++i) {
            if (events_[i].active &&
                events_[i].service_id == sid &&
                events_[i].event_id == eid) {
                return &events_[i];
            }
        }
        return nullptr;
    }

    const EventSlot* find_event_const(uint16_t sid, uint16_t eid) const {
        for (std::size_t i = 0; i < event_count_; ++i) {
            if (events_[i].active &&
                events_[i].service_id == sid &&
                events_[i].event_id == eid) {
                return &events_[i];
            }
        }
        return nullptr;
    }

    /// Simple monotonic time comparison (handles wrap within reason).
    static bool time_after(uint32_t now, uint32_t target) {
        return static_cast<int32_t>(now - target) > 0;
    }
};

} // namespace sero
