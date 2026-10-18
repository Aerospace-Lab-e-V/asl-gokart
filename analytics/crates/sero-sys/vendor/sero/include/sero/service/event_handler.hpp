#pragma once
/// @file event_handler.hpp
/// CRTP event handler interface + type-erased entry (§10.1).

#include <cstddef>
#include <cstdint>

namespace sero {

/// CRTP base for user event handler implementations.
template <typename Impl>
class IEventHandler {
public:
    void on_event(uint16_t service_id, uint16_t event_id,
                  const uint8_t* payload, std::size_t payload_length) {
        impl().impl_on_event(service_id, event_id, payload, payload_length);
    }

private:
    Impl& impl() { return *static_cast<Impl*>(this); }
};

// ── Type-erased event handler entry ─────────────────────────────────

using OnEventFn = void (*)(void* ctx, uint16_t service_id, uint16_t event_id,
                           const uint8_t* payload, std::size_t payload_length);

struct EventHandlerEntry {
    uint16_t   service_id = 0;
    uint16_t   event_id   = 0;
    bool       active     = false;
    void*      context    = nullptr;
    OnEventFn  on_event_fn = nullptr;
};

/// Create an EventHandlerEntry from a concrete IEventHandler<Impl>.
template <typename Impl>
EventHandlerEntry make_event_handler_entry(uint16_t service_id,
                                            uint16_t event_id,
                                            IEventHandler<Impl>& handler)
{
    EventHandlerEntry e;
    e.service_id  = service_id;
    e.event_id    = event_id;
    e.active      = true;
    e.context     = static_cast<void*>(static_cast<Impl*>(&handler));
    e.on_event_fn = [](void* ctx, uint16_t sid, uint16_t eid,
                       const uint8_t* p, std::size_t plen) {
        static_cast<Impl*>(ctx)->impl_on_event(sid, eid, p, plen);
    };
    return e;
}

} // namespace sero
