#pragma once
/// @file method_dispatcher.hpp
/// Route incoming requests to registered service handlers (§5, §10.2).

#include <array>
#include <cstddef>
#include <cstdint>

#include "sero/core/types.hpp"
#include "sero/core/log.hpp"
#include "sero/service/service.hpp"

namespace sero {

template <typename Config>
class MethodDispatcher {
public:
    MethodDispatcher() = default;

    void set_logger(Logger<Config>* logger) { logger_ = logger; }

    /// Register a service. Returns false if table full or duplicate ID.
    bool register_service(const ServiceEntry& entry) {
        // Check for duplicate
        for (std::size_t i = 0; i < count_; ++i) {
            if (services_[i].active && services_[i].service_id == entry.service_id) {
                if (logger_) logger_->warn(LogCategory::Methods, "svc_duplicate",
                                            entry.service_id, 0, 0, 0);
                return false;
            }
        }
        if (count_ >= Config::MaxServices) {
            if (logger_) logger_->warn(LogCategory::Methods, "svc_table_full",
                                        entry.service_id, 0, 0,
                                        static_cast<uint32_t>(count_));
            return false;
        }
        services_[count_] = entry;
        ++count_;
        if (logger_) logger_->info(LogCategory::Methods, "svc_registered",
                                    entry.service_id, 0, 0,
                                    static_cast<uint32_t>(count_));
        return true;
    }

    /// Unregister a service by ID. Returns false if not found.
    bool unregister_service(uint16_t service_id) {
        for (std::size_t i = 0; i < count_; ++i) {
            if (services_[i].active && services_[i].service_id == service_id) {
                // Move last into this slot to keep array compact
                if (i != count_ - 1) services_[i] = services_[count_ - 1];
                services_[count_ - 1] = ServiceEntry{};
                --count_;
                if (logger_) logger_->info(LogCategory::Methods, "svc_unregistered",
                                            service_id, 0, 0,
                                            static_cast<uint32_t>(count_));
                return true;
            }
        }
        return false;
    }

    /// Dispatch a request to the appropriate service handler.
    /// @return The ReturnCode indicating the result.
    ReturnCode dispatch(uint16_t service_id, uint16_t method_id,
                        const uint8_t* payload, std::size_t payload_length,
                        uint8_t* response, std::size_t& response_length) const
    {
        const ServiceEntry* svc = find(service_id);
        if (!svc) {
            if (logger_) logger_->debug(LogCategory::Methods, "dispatch_unknown_svc",
                                         service_id, method_id, 0, 0);
            return ReturnCode::E_UNKNOWN_SERVICE;
        }
        if (!svc->is_ready_fn(svc->context)) {
            if (logger_) logger_->debug(LogCategory::Methods, "dispatch_not_ready",
                                         service_id, method_id, 0, 0);
            return ReturnCode::E_NOT_READY;
        }
        ReturnCode rc = svc->on_request_fn(svc->context, method_id,
                                  payload, payload_length,
                                  response, response_length);
        if (logger_) logger_->debug(LogCategory::Methods, "dispatch_result",
                                     service_id, method_id, 0,
                                     static_cast<uint32_t>(rc));
        return rc;
    }

    /// Look up a service entry (for auth policy checks etc.)
    const ServiceEntry* find(uint16_t service_id) const {
        for (std::size_t i = 0; i < count_; ++i) {
            if (services_[i].active && services_[i].service_id == service_id) {
                return &services_[i];
            }
        }
        return nullptr;
    }

    std::size_t count() const { return count_; }

    /// Iterate over all active services (for SD offers).
    template <typename Fn>
    void for_each(Fn&& fn) const {
        for (std::size_t i = 0; i < count_; ++i) {
            if (services_[i].active) fn(services_[i]);
        }
    }

private:
    std::array<ServiceEntry, Config::MaxServices> services_{};
    std::size_t count_ = 0;
    Logger<Config>* logger_ = nullptr;
};

} // namespace sero
