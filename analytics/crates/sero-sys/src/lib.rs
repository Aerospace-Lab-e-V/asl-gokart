//! Rust bindings for [sero](https://github.com/mad201802/sero), the zone controllers'
//! service-oriented UDP protocol.
//!
//! The C++ library is a git submodule (`vendor/sero`, pinned to a release tag) and is
//! wrapped by a small C shim (`shim/`) that adds a Linux UDP transport. On top of that:
//!
//! - [`Runtime`]: one sero runtime, single-threaded, driven by [`Runtime::process`]
//! - [`spawn`]: runs a runtime on its own thread and accepts [`Command`]s from anywhere
//! - [`net`]: IPv4 addresses of network interfaces
//!
//! Nothing here is specific to the kart; the crate is meant to move into the sero
//! repository eventually.

pub mod ffi;
pub mod net;
mod thread;

use std::{
    ffi::{CStr, CString, c_char, c_int, c_void},
    io,
    net::{Ipv4Addr, SocketAddrV4},
    os::fd::RawFd,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr::NonNull,
};

pub use thread::{Command, SeroThread, now_ms, spawn};

pub const DEFAULT_MCAST_GROUP: Ipv4Addr = Ipv4Addr::new(239, 0, 0, 1);
pub const DEFAULT_MCAST_PORT: u16 = 30490;

/// Sero return codes (`sero::ReturnCode`).
pub mod rc {
    pub const E_OK: u8 = 0x00;
    pub const E_NOT_OK: u8 = 0x01;
    pub const E_UNKNOWN_SERVICE: u8 = 0x02;
    pub const E_UNKNOWN_METHOD: u8 = 0x03;
    pub const E_NOT_READY: u8 = 0x04;
}

/// Names of the diagnostic counters, in the order [`Runtime::diagnostics`] returns them.
pub const DIAGNOSTIC_COUNTERS: [&str; 9] = [
    "crc_errors",
    "version_mismatches",
    "oversized_payloads",
    "type_id_mismatches",
    "duplicate_messages",
    "stale_messages",
    "auth_failures",
    "unknown_message_types",
    "dropped_messages",
];

#[derive(Debug, Clone)]
pub struct Options {
    /// Local IPv4 address: unicast bind address, multicast interface, and the address
    /// advertised to peers.
    pub bind_ip: Ipv4Addr,
    pub unicast_port: u16,
    pub client_id: u16,
    pub mcast_group: Ipv4Addr,
    pub mcast_port: u16,
    /// Deliver our own multicast to sockets on this host (peers on the same machine).
    pub mcast_loop: bool,
}

impl Options {
    pub fn new(bind_ip: Ipv4Addr, unicast_port: u16, client_id: u16) -> Self {
        Self {
            bind_ip,
            unicast_port,
            client_id,
            mcast_group: DEFAULT_MCAST_GROUP,
            mcast_port: DEFAULT_MCAST_PORT,
            mcast_loop: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    ServiceFound {
        service: u16,
        provider: SocketAddrV4,
    },
    ServiceLost {
        service: u16,
    },
    SubscriptionAck {
        service: u16,
        event: u16,
        return_code: u8,
        granted_ttl_s: u16,
    },
    Notification {
        service: u16,
        event: u16,
        payload: Vec<u8>,
        /// Wall-clock receive time (CLOCK_REALTIME), µs since the Unix epoch.
        rx_unix_us: i64,
    },
    Log(LogRecord),
    /// A [`Command`] sent to a [`SeroThread`] was rejected by the runtime.
    CommandFailed {
        command: &'static str,
        service: u16,
        id: u16,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LogRecord {
    pub level: LogLevel,
    /// `sero::LogCategory` as a number.
    pub category: u8,
    pub tag: String,
    pub service: u16,
    pub method_event: u16,
    pub client: u16,
    pub extra: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsumerState {
    NotFound,
    Searching,
    Found,
}

/// Receives everything a runtime reports. Called synchronously from
/// [`Runtime::process`] (and [`Runtime::notify`]) on the runtime's thread.
pub trait Handler {
    fn on_event(&mut self, event: Event);

    /// Provider side: answer a request to one of our services. The returned bytes are
    /// the response payload; an `Err` is a sero return code.
    fn on_request(&mut self, _service: u16, _method: u16, _payload: &[u8]) -> Result<Vec<u8>, u8> {
        Err(rc::E_UNKNOWN_METHOD)
    }
}

/// Static facts about the compiled shim, for sanity checks.
pub fn info() -> ffi::sero_shim_info {
    let mut info = ffi::sero_shim_info::default();
    // SAFETY: writes a plain struct; thread-safe by contract.
    unsafe { ffi::sero_shim_info_get(&mut info) };
    info
}

/// One sero runtime. Not `Send`: the shim must only be used from the thread that
/// created it. Use [`spawn`] to run one in the background.
pub struct Runtime {
    raw: NonNull<ffi::sero_shim>,
    // From Box::into_raw of a second box, so the callback context is a thin pointer.
    handler: *mut Box<dyn Handler>,
}

impl Runtime {
    pub fn new(options: &Options, handler: Box<dyn Handler>) -> io::Result<Self> {
        let handler = Box::into_raw(Box::new(handler));
        let bind_ip = CString::new(options.bind_ip.to_string()).expect("no NUL in an IP");
        let group = CString::new(options.mcast_group.to_string()).expect("no NUL in an IP");
        let opts = ffi::sero_shim_options {
            bind_ip: bind_ip.as_ptr(),
            unicast_port: options.unicast_port,
            client_id: options.client_id,
            mcast_group: group.as_ptr(),
            mcast_port: options.mcast_port,
            mcast_loop: options.mcast_loop as u8,
        };
        let callbacks = ffi::sero_shim_callbacks {
            ctx: handler.cast(),
            on_service_found: Some(on_service_found),
            on_service_lost: Some(on_service_lost),
            on_subscription_ack: Some(on_subscription_ack),
            on_event: Some(on_event),
            on_request: Some(on_request),
            on_log: Some(on_log),
        };
        let mut err: c_int = 0;
        // SAFETY: the option strings outlive the call; the shim copies the callbacks
        // and keeps `ctx`, which the returned value owns and frees only after the
        // shim is destroyed.
        let raw = unsafe { ffi::sero_shim_create(&opts, &callbacks, &mut err) };
        match NonNull::new(raw) {
            Some(raw) => Ok(Self { raw, handler }),
            None => {
                // SAFETY: the shim was not created, so nothing else holds `handler`.
                drop(unsafe { Box::from_raw(handler) });
                Err(io::Error::from_raw_os_error(err))
            }
        }
    }

    /// Hands an event to the handler directly, outside any shim callback.
    pub(crate) fn report(&mut self, event: Event) {
        // SAFETY: `&mut self` means no shim call, and so no callback, is in progress.
        unsafe { with_handler(self.handler.cast(), |h| h.on_event(event)) }
    }

    /// Sockets to wait on for readability before calling [`Runtime::process`].
    pub fn fds(&self) -> Vec<RawFd> {
        let mut fds = [0 as c_int; 2];
        // SAFETY: valid shim; capacity matches the buffer.
        let n = unsafe { ffi::sero_shim_fds(self.raw.as_ptr(), fds.as_mut_ptr(), fds.len()) };
        fds[..n].to_vec()
    }

    pub fn local_addr(&self) -> SocketAddrV4 {
        let mut a = ffi::sero_shim_addr::default();
        // SAFETY: valid shim, plain out-struct.
        unsafe { ffi::sero_shim_local_addr(self.raw.as_ptr(), &mut a) };
        SocketAddrV4::new(Ipv4Addr::from(a.ip), a.port)
    }

    /// Reads pending datagrams, dispatches them to the handler and runs timers.
    /// `now_ms` comes from a monotonic clock, e.g. [`now_ms`].
    pub fn process(&mut self, now_ms: u32) {
        // SAFETY: valid shim, used from its own thread (`!Send`).
        unsafe { ffi::sero_shim_process(self.raw.as_ptr(), now_ms) }
    }

    pub fn find(&mut self, service: u16, major: u8, now_ms: u32) -> bool {
        // SAFETY: as above.
        unsafe { ffi::sero_shim_find(self.raw.as_ptr(), service, major, now_ms) }
    }

    /// Subscribes to an event. May be called before the service is found; the
    /// subscription is sent once it is.
    pub fn subscribe(&mut self, service: u16, event: u16, ttl_s: u16, now_ms: u32) -> bool {
        // SAFETY: as above.
        unsafe { ffi::sero_shim_subscribe(self.raw.as_ptr(), service, event, ttl_s, now_ms) }
    }

    pub fn unsubscribe(&mut self, service: u16, event: u16) -> bool {
        // SAFETY: as above.
        unsafe { ffi::sero_shim_unsubscribe(self.raw.as_ptr(), service, event) }
    }

    pub fn consumer_state(&self, service: u16) -> ConsumerState {
        // SAFETY: as above.
        match unsafe { ffi::sero_shim_consumer_state(self.raw.as_ptr(), service) } {
            1 => ConsumerState::Searching,
            2 => ConsumerState::Found,
            _ => ConsumerState::NotFound,
        }
    }

    pub fn register_service(&mut self, service: u16, major: u8, minor: u8) -> bool {
        // SAFETY: as above.
        unsafe { ffi::sero_shim_register_service(self.raw.as_ptr(), service, major, minor) }
    }

    pub fn register_event(&mut self, service: u16, event: u16) -> bool {
        // SAFETY: as above.
        unsafe { ffi::sero_shim_register_event(self.raw.as_ptr(), service, event) }
    }

    pub fn offer(&mut self, service: u16, ttl_s: u16, now_ms: u32) -> bool {
        // SAFETY: as above.
        unsafe { ffi::sero_shim_offer(self.raw.as_ptr(), service, ttl_s, now_ms) }
    }

    pub fn stop_offer(&mut self, service: u16) {
        // SAFETY: as above.
        unsafe { ffi::sero_shim_stop_offer(self.raw.as_ptr(), service) }
    }

    /// Sends a notification to every subscriber. `false` if there are none.
    pub fn notify(&mut self, service: u16, event: u16, payload: &[u8]) -> bool {
        // SAFETY: as above; the payload is only read during the call.
        unsafe {
            ffi::sero_shim_notify(
                self.raw.as_ptr(),
                service,
                event,
                payload.as_ptr(),
                payload.len(),
            )
        }
    }

    /// Diagnostic counters, named by [`DIAGNOSTIC_COUNTERS`].
    pub fn diagnostics(&self) -> [u32; 9] {
        let mut counters = [0u32; 9];
        // SAFETY: valid shim; capacity matches the buffer.
        unsafe {
            ffi::sero_shim_diagnostics(self.raw.as_ptr(), counters.as_mut_ptr(), counters.len())
        };
        counters
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        // SAFETY: created by sero_shim_create, destroyed exactly once; no callback
        // runs after this returns, so freeing the handler afterwards is fine.
        unsafe {
            ffi::sero_shim_destroy(self.raw.as_ptr());
            drop(Box::from_raw(self.handler));
        }
    }
}

// ── Callback trampolines ────────────────────────────────────────────────────
//
// A panic must not unwind into C++, so each body runs under catch_unwind. A
// panicking handler loses that one callback.

/// # Safety
/// `ctx` is the `Box<dyn Handler>` registered in [`Runtime::new`], and the shim
/// calls back only on the runtime's thread while no other borrow of it exists.
unsafe fn with_handler(ctx: *mut c_void, f: impl FnOnce(&mut dyn Handler)) {
    // SAFETY: see the function's contract.
    let handler = unsafe { &mut **ctx.cast::<Box<dyn Handler>>() };
    let _ = catch_unwind(AssertUnwindSafe(|| f(handler)));
}

unsafe extern "C" fn on_service_found(ctx: *mut c_void, service: u16, a: ffi::sero_shim_addr) {
    let provider = SocketAddrV4::new(Ipv4Addr::from(a.ip), a.port);
    // SAFETY: called by the shim with our ctx.
    unsafe {
        with_handler(ctx, |h| {
            h.on_event(Event::ServiceFound { service, provider })
        })
    }
}

unsafe extern "C" fn on_service_lost(ctx: *mut c_void, service: u16) {
    // SAFETY: called by the shim with our ctx.
    unsafe { with_handler(ctx, |h| h.on_event(Event::ServiceLost { service })) }
}

unsafe extern "C" fn on_subscription_ack(
    ctx: *mut c_void,
    service: u16,
    event: u16,
    return_code: u8,
    granted_ttl_s: u16,
) {
    let event = Event::SubscriptionAck {
        service,
        event,
        return_code,
        granted_ttl_s,
    };
    // SAFETY: called by the shim with our ctx.
    unsafe { with_handler(ctx, |h| h.on_event(event)) }
}

unsafe extern "C" fn on_event(
    ctx: *mut c_void,
    service: u16,
    event: u16,
    payload: *const u8,
    len: usize,
    rx_unix_us: i64,
) {
    // SAFETY: the shim passes a buffer of `len` bytes valid for this call.
    let payload = unsafe { bytes(payload, len) }.to_vec();
    let event = Event::Notification {
        service,
        event,
        payload,
        rx_unix_us,
    };
    // SAFETY: called by the shim with our ctx.
    unsafe { with_handler(ctx, |h| h.on_event(event)) }
}

unsafe extern "C" fn on_request(
    ctx: *mut c_void,
    service: u16,
    method: u16,
    payload: *const u8,
    len: usize,
    response: *mut u8,
    response_len: *mut usize,
) -> u8 {
    // SAFETY: the shim passes a buffer of `len` bytes valid for this call.
    let payload = unsafe { bytes(payload, len) };
    let mut code = rc::E_NOT_OK;
    // SAFETY: called by the shim with our ctx.
    unsafe {
        with_handler(ctx, |h| match h.on_request(service, method, payload) {
            Ok(body) => {
                code = rc::E_OK;
                if !response.is_null() {
                    let n = body.len().min(*response_len);
                    std::ptr::copy_nonoverlapping(body.as_ptr(), response, n);
                    *response_len = n;
                }
            }
            Err(c) => code = c,
        })
    };
    code
}

#[allow(clippy::too_many_arguments)]
unsafe extern "C" fn on_log(
    ctx: *mut c_void,
    level: u8,
    category: u8,
    tag: *const c_char,
    service: u16,
    method_event: u16,
    client: u16,
    extra: u32,
) {
    let level = match level {
        0 => LogLevel::Trace,
        1 => LogLevel::Debug,
        2 => LogLevel::Info,
        3 => LogLevel::Warn,
        _ => LogLevel::Error,
    };
    let tag = if tag.is_null() {
        String::new()
    } else {
        // SAFETY: sero passes NUL-terminated string literals.
        unsafe { CStr::from_ptr(tag) }
            .to_string_lossy()
            .into_owned()
    };
    let record = LogRecord {
        level,
        category,
        tag,
        service,
        method_event,
        client,
        extra,
    };
    // SAFETY: called by the shim with our ctx.
    unsafe { with_handler(ctx, |h| h.on_event(Event::Log(record))) }
}

/// # Safety
/// `ptr` points to `len` readable bytes (or `len` is 0).
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        // SAFETY: see the function's contract.
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}
