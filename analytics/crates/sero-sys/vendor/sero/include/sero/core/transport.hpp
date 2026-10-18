#pragma once
/// @file transport.hpp
/// CRTP transport abstraction (§3).

#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"

namespace sero {

/// CRTP base for user-provided transport implementations.
/// Concrete class must implement impl_send, impl_broadcast, impl_poll.
template <typename Impl, typename Config>
class ITransport {
public:
    using Addr = Address<Config>;

    /// Unicast send. Returns true on success.
    bool send(const Addr& destination, const uint8_t* data, std::size_t length) {
        return impl().impl_send(destination, data, length);
    }

    /// Broadcast (for SD). Returns true on success.
    bool broadcast(const uint8_t* data, std::size_t length) {
        return impl().impl_broadcast(data, length);
    }

    /// Dequeue next received message. Returns false if queue empty.
    /// Returned data pointer valid only until next poll() call.
    bool poll(Addr& source, const uint8_t*& data, std::size_t& length) {
        return impl().impl_poll(source, data, length);
    }

private:
    Impl& impl() { return *static_cast<Impl*>(this); }
};

} // namespace sero
