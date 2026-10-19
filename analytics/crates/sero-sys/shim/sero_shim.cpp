// C ABI over sero::Runtime with a Linux UDP transport (see sero_shim.h).
//
// Built with -fno-exceptions -fno-rtti and without linking a C++ standard
// library: sero is header-only and allocation-free, and the shim itself is
// allocated with malloc + placement new. That keeps the Rust binary free of a
// libstdc++/libc++ dependency, which matters for cross-compiled Pi builds.

#include "sero_shim.h"

#include <sero.hpp>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <new>

namespace sero_shim_config {

// Based on sero::DefaultConfig. Only TransportAddressSize, the protocol version
// and the payload limit affect the wire; everything else is local sizing.
// (A named namespace: clang flags unused members of internal-linkage structs.)
struct KartShimConfig {
    static constexpr std::size_t MaxPayloadSize          = 1400;
    static constexpr std::size_t MaxServices             = 8;
    static constexpr std::size_t MaxMethods              = 16;
    static constexpr std::size_t MaxEvents               = 16;
    static constexpr std::size_t MaxSubscribers          = 8;
    static constexpr std::size_t MaxPendingRequests      = 16;
    static constexpr std::size_t MaxKnownServices        = 16;
    static constexpr uint32_t    RequestTimeoutMs        = 1000;
    // Match the zone controllers (zc_*/src/config.hpp).
    static constexpr uint16_t    OfferTtlSeconds         = 10;
    static constexpr uint16_t    SubscriptionTtlSeconds  = 15;
    static constexpr uint8_t     SdFindRetryCount        = 5;
    static constexpr uint32_t    SdFindInitialDelayMs    = 200;
    static constexpr uint8_t     SdFindBackoffMultiplier = 2;
    static constexpr uint32_t    SdFindJitterMs          = 50;
    // Receiver side only. With the default of 15, a burst of lost notifications
    // makes every later one look stale until the 8-bit counter wraps around, so a
    // logger would go blind for seconds. Accept any forward jump; exact
    // duplicates are still dropped.
    static constexpr uint8_t     SeqCounterAcceptWindow  = 255;
    static constexpr std::size_t TransportAddressSize    = 8;
    static constexpr std::size_t MaxReceiveQueueSize     = 64;
    static constexpr std::size_t MaxTrackedPeers         = 32;
    static constexpr std::size_t HmacKeySize             = 32;
    static constexpr std::size_t MaxDtcs                 = 0;
    static constexpr sero::LogLevel MinLogLevel          = sero::LogLevel::Info;
};

} // namespace sero_shim_config

namespace {

using Config = sero_shim_config::KartShimConfig;
using Addr   = sero::Address<Config>;

static_assert(Config::TransportAddressSize == 8,
              "wire format: [IPv4 4B][port BE 2B][padding 2B]");

constexpr const char* DEFAULT_MCAST_GROUP = "239.0.0.1";
constexpr uint16_t    DEFAULT_MCAST_PORT  = 30490;

int64_t now_unix_us() {
    timespec ts{};
    clock_gettime(CLOCK_REALTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

Addr make_addr(in_addr ip, uint16_t port) {
    Addr a{};
    std::memcpy(a.data(), &ip, 4);
    a[4] = static_cast<uint8_t>(port >> 8);
    a[5] = static_cast<uint8_t>(port & 0xFF);
    return a;
}

sockaddr_in to_sockaddr(const Addr& a) {
    sockaddr_in sa{};
    sa.sin_family = AF_INET;
    std::memcpy(&sa.sin_addr, a.data(), 4);
    sa.sin_port = htons(static_cast<uint16_t>((a[4] << 8) | a[5]));
    return sa;
}

sero_shim_addr to_shim_addr(const Addr& a) {
    sero_shim_addr out{};
    std::memcpy(out.ip, a.data(), 4);
    out.port = static_cast<uint16_t>((a[4] << 8) | a[5]);
    return out;
}

// Unicast socket for everything we send and for replies to us; a second socket
// joined to the SD multicast group. Derived from sero-node's NodeUdpTransport,
// but the unicast socket sets no reuse flags: two clients on one port would
// split the datagrams between them, so a clash must fail loudly.
class LinuxUdpTransport : public sero::ITransport<LinuxUdpTransport, Config> {
public:
    static constexpr std::size_t MAX_BUF =
        sero::HEADER_SIZE + Config::MaxPayloadSize + sero::HMAC_SIZE + sero::CRC_SIZE;

    ~LinuxUdpTransport() { close_all(); }

    /// Returns 0 or an errno value.
    int init(const sero_shim_options& o) {
        in_addr bind_ip{};
        if (!o.bind_ip || inet_pton(AF_INET, o.bind_ip, &bind_ip) != 1) return EINVAL;
        in_addr group{};
        if (inet_pton(AF_INET, o.mcast_group ? o.mcast_group : DEFAULT_MCAST_GROUP, &group) != 1) {
            return EINVAL;
        }
        uint16_t mcast_port = o.mcast_port ? o.mcast_port : DEFAULT_MCAST_PORT;

        unicast_fd_ = ::socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        if (unicast_fd_ < 0) return errno;
        sockaddr_in uaddr{};
        uaddr.sin_family = AF_INET;
        uaddr.sin_port   = htons(o.unicast_port);
        uaddr.sin_addr   = bind_ip;
        if (::bind(unicast_fd_, reinterpret_cast<sockaddr*>(&uaddr), sizeof(uaddr)) < 0) {
            return errno;
        }
        // Port 0 lets the kernel choose; peers must be told the real one.
        socklen_t ulen = sizeof(uaddr);
        if (::getsockname(unicast_fd_, reinterpret_cast<sockaddr*>(&uaddr), &ulen) < 0) {
            return errno;
        }
        if (setsockopt(unicast_fd_, IPPROTO_IP, IP_MULTICAST_IF, &bind_ip, sizeof(bind_ip)) < 0) {
            return errno;
        }
        uint8_t loop = o.mcast_loop ? 1 : 0;
        setsockopt(unicast_fd_, IPPROTO_IP, IP_MULTICAST_LOOP, &loop, sizeof(loop));

        // The headunit binds the same group and port; SO_REUSEADDR lets both
        // sockets bind and each gets its own copy of every multicast datagram.
        mcast_fd_ = ::socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        if (mcast_fd_ < 0) return errno;
        int reuse = 1;
        setsockopt(mcast_fd_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
        sockaddr_in maddr{};
        maddr.sin_family = AF_INET;
        maddr.sin_port   = htons(mcast_port);
        maddr.sin_addr   = group;
        if (::bind(mcast_fd_, reinterpret_cast<sockaddr*>(&maddr), sizeof(maddr)) < 0) {
            return errno;
        }
        ip_mreq mreq{};
        mreq.imr_multiaddr = group;
        mreq.imr_interface = bind_ip;
        if (setsockopt(mcast_fd_, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mreq, sizeof(mreq)) < 0) {
            return errno;
        }

        group_      = make_addr(group, mcast_port);
        local_addr_ = make_addr(bind_ip, ntohs(uaddr.sin_port));
        return 0;
    }

    const Addr& local_addr() const { return local_addr_; }
    int unicast_fd() const { return unicast_fd_; }
    int mcast_fd() const { return mcast_fd_; }
    int64_t last_rx_unix_us() const { return last_rx_unix_us_; }

    bool impl_send(const Addr& dest, const uint8_t* data, std::size_t len) {
        sockaddr_in sa = to_sockaddr(dest);
        ssize_t n = ::sendto(unicast_fd_, data, len, 0, reinterpret_cast<sockaddr*>(&sa),
                             sizeof(sa));
        return n == static_cast<ssize_t>(len);
    }

    bool impl_broadcast(const uint8_t* data, std::size_t len) { return impl_send(group_, data, len); }

    bool impl_poll(Addr& source, const uint8_t*& data, std::size_t& len) {
        return try_recv(mcast_fd_, source, data, len) || try_recv(unicast_fd_, source, data, len);
    }

private:
    int     unicast_fd_ = -1;
    int     mcast_fd_   = -1;
    Addr    local_addr_{};
    Addr    group_{};
    int64_t last_rx_unix_us_ = 0;
    uint8_t recv_buf_[MAX_BUF]{};

    void close_all() {
        if (unicast_fd_ >= 0) ::close(unicast_fd_);
        if (mcast_fd_ >= 0) ::close(mcast_fd_);
        unicast_fd_ = mcast_fd_ = -1;
    }

    bool try_recv(int fd, Addr& source, const uint8_t*& data, std::size_t& len) {
        sockaddr_in from{};
        socklen_t fromlen = sizeof(from);
        ssize_t n = ::recvfrom(fd, recv_buf_, sizeof(recv_buf_), 0,
                               reinterpret_cast<sockaddr*>(&from), &fromlen);
        if (n <= 0) return false;
        last_rx_unix_us_ = now_unix_us();
        source = make_addr(from.sin_addr, ntohs(from.sin_port));
        data   = recv_buf_;
        len    = static_cast<std::size_t>(n);
        return true;
    }
};

using Runtime = sero::Runtime<LinuxUdpTransport, Config>;

struct ShimEventHandler : sero::IEventHandler<ShimEventHandler> {
    sero_shim* shim = nullptr;
    void impl_on_event(uint16_t service_id, uint16_t event_id, const uint8_t* payload,
                       std::size_t len);
};

struct ShimService : sero::IService<ShimService> {
    sero_shim* shim       = nullptr;
    uint16_t   service_id = 0;
    sero::ReturnCode impl_on_request(uint16_t method_id, const uint8_t* payload, std::size_t len,
                                     uint8_t* response, std::size_t& response_len);
    bool impl_is_ready() const { return true; }
};

} // namespace

struct sero_shim {
    sero_shim_callbacks cb;
    LinuxUdpTransport   transport;
    Runtime             runtime;
    ShimEventHandler    handler;
    ShimService         services[Config::MaxServices];
    std::size_t         service_count = 0;

    sero_shim(uint16_t client_id, const sero_shim_callbacks& callbacks)
        : cb(callbacks), transport(), runtime(transport, client_id) {}
};

namespace {

void ShimEventHandler::impl_on_event(uint16_t service_id, uint16_t event_id,
                                     const uint8_t* payload, std::size_t len) {
    // Notifications are dispatched synchronously right after the datagram was
    // read, so the transport's last receive time belongs to this one.
    if (shim->cb.on_event) {
        shim->cb.on_event(shim->cb.ctx, service_id, event_id, payload, len,
                          shim->transport.last_rx_unix_us());
    }
}

sero::ReturnCode ShimService::impl_on_request(uint16_t method_id, const uint8_t* payload,
                                              std::size_t len, uint8_t* response,
                                              std::size_t& response_len) {
    if (!shim->cb.on_request) return sero::ReturnCode::E_UNKNOWN_METHOD;
    std::size_t cap = response ? response_len : 0;
    uint8_t rc = shim->cb.on_request(shim->cb.ctx, service_id, method_id, payload, len,
                                     response, &cap);
    response_len = response ? cap : 0;
    return static_cast<sero::ReturnCode>(rc);
}

void on_service_found(uint16_t service_id, const Addr& provider, void* ctx) {
    auto* shim = static_cast<sero_shim*>(ctx);
    if (shim->cb.on_service_found) {
        shim->cb.on_service_found(shim->cb.ctx, service_id, to_shim_addr(provider));
    }
}

void on_service_lost(uint16_t service_id, void* ctx) {
    auto* shim = static_cast<sero_shim*>(ctx);
    if (shim->cb.on_service_lost) shim->cb.on_service_lost(shim->cb.ctx, service_id);
}

void on_subscription_ack(uint16_t service_id, uint16_t event_id, sero::ReturnCode rc,
                         uint16_t granted_ttl, void* ctx) {
    auto* shim = static_cast<sero_shim*>(ctx);
    if (shim->cb.on_subscription_ack) {
        shim->cb.on_subscription_ack(shim->cb.ctx, service_id, event_id,
                                     static_cast<uint8_t>(rc), granted_ttl);
    }
}

void on_log(const sero::LogEntry& e, void* ctx) {
    auto* shim = static_cast<sero_shim*>(ctx);
    if (shim->cb.on_log) {
        shim->cb.on_log(shim->cb.ctx, static_cast<uint8_t>(e.level),
                        static_cast<uint8_t>(e.category), e.tag, e.service_id,
                        e.method_event_id, e.client_id, e.extra);
    }
}

} // namespace

extern "C" {

void sero_shim_info_get(sero_shim_info* out) {
    out->abi_version         = SERO_SHIM_ABI_VERSION;
    out->max_payload         = Config::MaxPayloadSize;
    out->transport_addr_size = Config::TransportAddressSize;
    out->seq_accept_window   = Config::SeqCounterAcceptWindow;
    out->max_services        = Config::MaxServices;
    out->max_known_services  = Config::MaxKnownServices;
    out->max_events          = Config::MaxEvents;
    out->diagnostic_counters = static_cast<uint32_t>(sero::DiagnosticCounter::_Count);
}

sero_shim* sero_shim_create(const sero_shim_options* options,
                            const sero_shim_callbacks* callbacks, int* err) {
    void* mem = std::malloc(sizeof(sero_shim));
    if (!mem) {
        if (err) *err = ENOMEM;
        return nullptr;
    }
    auto* shim = new (mem) sero_shim(options->client_id, *callbacks);
    int rc = shim->transport.init(*options);
    if (rc != 0) {
        sero_shim_destroy(shim);
        if (err) *err = rc;
        return nullptr;
    }
    shim->handler.shim = shim;
    shim->runtime.set_local_address(shim->transport.local_addr());
    auto& sd                = shim->runtime.sd_callbacks();
    sd.on_service_found     = on_service_found;
    sd.service_found_ctx    = shim;
    sd.on_service_lost      = on_service_lost;
    sd.service_lost_ctx     = shim;
    sd.on_subscription_ack  = on_subscription_ack;
    sd.subscription_ack_ctx = shim;
    shim->runtime.set_log_callback(on_log, shim);
    if (err) *err = 0;
    return shim;
}

void sero_shim_destroy(sero_shim* shim) {
    if (!shim) return;
    shim->~sero_shim();
    std::free(shim);
}

size_t sero_shim_fds(const sero_shim* shim, int* fds, size_t capacity) {
    int all[2] = {shim->transport.unicast_fd(), shim->transport.mcast_fd()};
    size_t n = 0;
    for (int fd : all) {
        if (fd >= 0 && n < capacity) fds[n++] = fd;
    }
    return n;
}

void sero_shim_local_addr(const sero_shim* shim, sero_shim_addr* out) {
    *out = to_shim_addr(shim->transport.local_addr());
}

void sero_shim_process(sero_shim* shim, uint32_t now_ms) { shim->runtime.process(now_ms); }

bool sero_shim_find(sero_shim* shim, uint16_t service_id, uint8_t major, uint32_t now_ms) {
    return shim->runtime.find_service(service_id, major, now_ms);
}

bool sero_shim_subscribe(sero_shim* shim, uint16_t service_id, uint16_t event_id, uint16_t ttl_s,
                         uint32_t now_ms) {
    return shim->runtime.subscribe_event(service_id, event_id, shim->handler, ttl_s, now_ms);
}

bool sero_shim_unsubscribe(sero_shim* shim, uint16_t service_id, uint16_t event_id) {
    return shim->runtime.unsubscribe_event(service_id, event_id);
}

int sero_shim_consumer_state(const sero_shim* shim, uint16_t service_id) {
    using State = sero::ServiceDiscovery<Config>::ConsumerState;
    auto& sd = const_cast<sero_shim*>(shim)->runtime.service_discovery();
    switch (sd.get_consumer_state(service_id)) {
        case State::SEARCHING: return 1;
        case State::FOUND: return 2;
        default: return 0;
    }
}

bool sero_shim_register_service(sero_shim* shim, uint16_t service_id, uint8_t major,
                                uint8_t minor) {
    if (shim->service_count >= Config::MaxServices) return false;
    ShimService& svc = shim->services[shim->service_count];
    svc.shim         = shim;
    svc.service_id   = service_id;
    if (!shim->runtime.register_service(service_id, svc, major, minor)) return false;
    ++shim->service_count;
    return true;
}

bool sero_shim_register_event(sero_shim* shim, uint16_t service_id, uint16_t event_id) {
    return shim->runtime.register_event(service_id, event_id);
}

bool sero_shim_offer(sero_shim* shim, uint16_t service_id, uint16_t ttl_s, uint32_t now_ms) {
    return shim->runtime.offer_service(service_id, ttl_s, now_ms);
}

void sero_shim_stop_offer(sero_shim* shim, uint16_t service_id) {
    shim->runtime.stop_offer(service_id);
}

bool sero_shim_notify(sero_shim* shim, uint16_t service_id, uint16_t event_id,
                      const uint8_t* payload, size_t len) {
    return shim->runtime.notify_event(service_id, event_id, payload, len);
}

size_t sero_shim_diagnostics(const sero_shim* shim, uint32_t* counters, size_t capacity) {
    const auto& d = shim->runtime.diagnostics();
    size_t n = static_cast<size_t>(sero::DiagnosticCounter::_Count);
    if (n > capacity) n = capacity;
    for (size_t i = 0; i < n; ++i) counters[i] = d.get(static_cast<sero::DiagnosticCounter>(i));
    return n;
}

} // extern "C"
