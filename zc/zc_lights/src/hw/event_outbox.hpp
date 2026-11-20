#pragma once
/// @file event_outbox.hpp
/// Which Sero events need sending. Any task may mark a bit; only loop() takes
/// them and calls notify_event, so the runtime's transmit buffer is never used
/// from two tasks at once.

#include <atomic>
#include <cstdint>

enum EventBit : uint32_t {
    EV_TURN      = 1u << 0,
    EV_HIGH_BEAM = 1u << 1,
    EV_BRAKE     = 1u << 2,
    EV_REVERSE   = 1u << 3,
    EV_DRL       = 1u << 4,
    EV_TAIL      = 1u << 5,
    EV_CONFIG    = 1u << 6,
    EV_WELCOME   = 1u << 7,
    EV_ALL       = 0xFFu,     ///< every event (a client asked for the full state)
    SAVE_CONFIG  = 1u << 8,   ///< settings changed → persist (not an event, not in EV_ALL)
};

class EventOutbox {
public:
    void mark(uint32_t bits) { bits_.fetch_or(bits, std::memory_order_relaxed); }
    uint32_t take() { return bits_.exchange(0, std::memory_order_relaxed); }

private:
    std::atomic<uint32_t> bits_{0};
};
