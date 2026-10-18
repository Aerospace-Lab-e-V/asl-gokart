/* C ABI over the header-only C++ sero runtime with a Linux UDP transport.
 *
 * Threading: a sero_shim is single-threaded. Every function except
 * sero_shim_info_get must be called from the same thread. Callbacks run
 * synchronously inside sero_shim_process / sero_shim_notify on that thread,
 * must not call back into the shim, and payload pointers are valid only for
 * the duration of the callback.
 */
#ifndef SERO_SHIM_H
#define SERO_SHIM_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SERO_SHIM_ABI_VERSION 1

typedef struct sero_shim sero_shim;

typedef struct {
    uint8_t ip[4];
    uint16_t port;
} sero_shim_addr;

typedef struct {
    /* IPv4 address to bind the unicast socket to; also advertised in offers. */
    const char* bind_ip;
    /* 0: chosen by the kernel (see sero_shim_local_addr) */
    uint16_t unicast_port;
    uint16_t client_id;
    /* NULL: 239.0.0.1 */
    const char* mcast_group;
    /* 0: 30490 */
    uint16_t mcast_port;
    /* Deliver our own multicast to local sockets (needed when peers share a host). */
    uint8_t mcast_loop;
} sero_shim_options;

typedef struct {
    void* ctx;
    void (*on_service_found)(void* ctx, uint16_t service_id, sero_shim_addr provider);
    void (*on_service_lost)(void* ctx, uint16_t service_id);
    void (*on_subscription_ack)(void* ctx, uint16_t service_id, uint16_t event_id,
                                uint8_t return_code, uint16_t granted_ttl_s);
    /* rx_unix_us: CLOCK_REALTIME right after the datagram was read. */
    void (*on_event)(void* ctx, uint16_t service_id, uint16_t event_id,
                     const uint8_t* payload, size_t len, int64_t rx_unix_us);
    /* Provider side. response is NULL for fire-and-forget requests. On entry
     * *response_len is the capacity of response; set it to the bytes written.
     * Returns a sero return code (0 = E_OK). May be NULL (E_UNKNOWN_METHOD). */
    uint8_t (*on_request)(void* ctx, uint16_t service_id, uint16_t method_id,
                          const uint8_t* payload, size_t len,
                          uint8_t* response, size_t* response_len);
    void (*on_log)(void* ctx, uint8_t level, uint8_t category, const char* tag,
                   uint16_t service_id, uint16_t method_event_id, uint16_t client_id,
                   uint32_t extra);
} sero_shim_callbacks;

typedef struct {
    uint32_t abi_version;
    uint32_t max_payload;
    uint32_t transport_addr_size;
    uint32_t seq_accept_window;
    uint32_t max_services;
    uint32_t max_known_services;
    uint32_t max_events;
    uint32_t diagnostic_counters;
} sero_shim_info;

void sero_shim_info_get(sero_shim_info* out);

/* Returns NULL and sets *err to an errno value on failure. */
sero_shim* sero_shim_create(const sero_shim_options* options,
                            const sero_shim_callbacks* callbacks, int* err);
void sero_shim_destroy(sero_shim* shim);

/* File descriptors to poll for readability; returns the count written. */
size_t sero_shim_fds(const sero_shim* shim, int* fds, size_t capacity);
void sero_shim_local_addr(const sero_shim* shim, sero_shim_addr* out);

/* now_ms: a monotonic millisecond clock; wrapping is fine. */
void sero_shim_process(sero_shim* shim, uint32_t now_ms);

/* Consumer side */
bool sero_shim_find(sero_shim* shim, uint16_t service_id, uint8_t major, uint32_t now_ms);
bool sero_shim_subscribe(sero_shim* shim, uint16_t service_id, uint16_t event_id,
                         uint16_t ttl_s, uint32_t now_ms);
bool sero_shim_unsubscribe(sero_shim* shim, uint16_t service_id, uint16_t event_id);
/* 0 = not found, 1 = searching, 2 = found */
int sero_shim_consumer_state(const sero_shim* shim, uint16_t service_id);

/* Provider side */
bool sero_shim_register_service(sero_shim* shim, uint16_t service_id, uint8_t major,
                                uint8_t minor);
bool sero_shim_register_event(sero_shim* shim, uint16_t service_id, uint16_t event_id);
bool sero_shim_offer(sero_shim* shim, uint16_t service_id, uint16_t ttl_s, uint32_t now_ms);
void sero_shim_stop_offer(sero_shim* shim, uint16_t service_id);
/* Returns false if nobody is subscribed. */
bool sero_shim_notify(sero_shim* shim, uint16_t service_id, uint16_t event_id,
                      const uint8_t* payload, size_t len);

/* Copies the diagnostic counters (sero::DiagnosticCounter order); returns the count. */
size_t sero_shim_diagnostics(const sero_shim* shim, uint32_t* counters, size_t capacity);

#ifdef __cplusplus
}
#endif

#endif /* SERO_SHIM_H */
