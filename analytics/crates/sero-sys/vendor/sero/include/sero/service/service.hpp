#pragma once
/// @file service.hpp
/// CRTP service interface + type-erased ServiceEntry (§10.1).

#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"

namespace sero {

/// CRTP base for user service implementations.
template <typename Impl>
class IService {
public:
    /// Called for REQUEST and REQUEST_NO_RETURN.
    /// For REQUEST_NO_RETURN the return value, response buffer and response_length are ignored.
    ReturnCode on_request(uint16_t method_id,
                          const uint8_t* payload, std::size_t payload_length,
                          uint8_t* response, std::size_t& response_length) {
        return impl().impl_on_request(method_id, payload, payload_length,
                                      response, response_length);
    }

    bool is_ready() const {
        return impl().impl_is_ready();
    }

private:
    Impl& impl() { return *static_cast<Impl*>(this); }
    const Impl& impl() const { return *static_cast<const Impl*>(this); }
};

// ── Type-erased service entry for registration in MethodDispatcher ──────

/// Function pointer types for type-erased dispatch.
using OnRequestFn = ReturnCode (*)(void* ctx,
                                    uint16_t method_id,
                                    const uint8_t* payload, std::size_t payload_length,
                                    uint8_t* response, std::size_t& response_length);

using IsReadyFn = bool (*)(const void* ctx);

struct ServiceEntry {
    uint16_t    service_id    = 0;
    uint8_t     major_version = 0;
    uint8_t     minor_version = 0;
    bool        auth_required = false;
    bool        active        = false;
    void*       context       = nullptr;
    OnRequestFn on_request_fn = nullptr;
    IsReadyFn   is_ready_fn   = nullptr;
};

/// Create a ServiceEntry from a concrete IService<Impl>.
template <typename Impl>
ServiceEntry make_service_entry(uint16_t service_id,
                                IService<Impl>& svc,
                                uint8_t major,
                                uint8_t minor,
                                bool auth_required = false)
{
    ServiceEntry e;
    e.service_id    = service_id;
    e.major_version = major;
    e.minor_version = minor;
    e.auth_required = auth_required;
    e.active        = true;
    e.context       = static_cast<void*>(static_cast<Impl*>(&svc));

    e.on_request_fn = [](void* ctx, uint16_t mid,
                         const uint8_t* p, std::size_t plen,
                         uint8_t* r, std::size_t& rlen) -> ReturnCode {
        return static_cast<Impl*>(ctx)->impl_on_request(mid, p, plen, r, rlen);
    };
    e.is_ready_fn = [](const void* ctx) -> bool {
        return static_cast<const Impl*>(ctx)->impl_is_ready();
    };
    return e;
}

} // namespace sero
