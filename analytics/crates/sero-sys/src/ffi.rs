//! Raw declarations matching `shim/sero_shim.h`.

#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_int, c_void};

#[repr(C)]
pub struct sero_shim {
    _private: [u8; 0],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct sero_shim_addr {
    pub ip: [u8; 4],
    pub port: u16,
}

#[repr(C)]
pub struct sero_shim_options {
    pub bind_ip: *const c_char,
    pub unicast_port: u16,
    pub client_id: u16,
    pub mcast_group: *const c_char,
    pub mcast_port: u16,
    pub mcast_loop: u8,
}

#[repr(C)]
pub struct sero_shim_callbacks {
    pub ctx: *mut c_void,
    pub on_service_found:
        Option<unsafe extern "C" fn(ctx: *mut c_void, service_id: u16, provider: sero_shim_addr)>,
    pub on_service_lost: Option<unsafe extern "C" fn(ctx: *mut c_void, service_id: u16)>,
    pub on_subscription_ack: Option<
        unsafe extern "C" fn(
            ctx: *mut c_void,
            service_id: u16,
            event_id: u16,
            return_code: u8,
            granted_ttl_s: u16,
        ),
    >,
    pub on_event: Option<
        unsafe extern "C" fn(
            ctx: *mut c_void,
            service_id: u16,
            event_id: u16,
            payload: *const u8,
            len: usize,
            rx_unix_us: i64,
        ),
    >,
    pub on_request: Option<
        unsafe extern "C" fn(
            ctx: *mut c_void,
            service_id: u16,
            method_id: u16,
            payload: *const u8,
            len: usize,
            response: *mut u8,
            response_len: *mut usize,
        ) -> u8,
    >,
    pub on_log: Option<
        unsafe extern "C" fn(
            ctx: *mut c_void,
            level: u8,
            category: u8,
            tag: *const c_char,
            service_id: u16,
            method_event_id: u16,
            client_id: u16,
            extra: u32,
        ),
    >,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct sero_shim_info {
    pub abi_version: u32,
    pub max_payload: u32,
    pub transport_addr_size: u32,
    pub seq_accept_window: u32,
    pub max_services: u32,
    pub max_known_services: u32,
    pub max_events: u32,
    pub diagnostic_counters: u32,
}

unsafe extern "C" {
    pub fn sero_shim_info_get(out: *mut sero_shim_info);
    pub fn sero_shim_create(
        options: *const sero_shim_options,
        callbacks: *const sero_shim_callbacks,
        err: *mut c_int,
    ) -> *mut sero_shim;
    pub fn sero_shim_destroy(shim: *mut sero_shim);
    pub fn sero_shim_fds(shim: *const sero_shim, fds: *mut c_int, capacity: usize) -> usize;
    pub fn sero_shim_local_addr(shim: *const sero_shim, out: *mut sero_shim_addr);
    pub fn sero_shim_process(shim: *mut sero_shim, now_ms: u32);
    pub fn sero_shim_find(shim: *mut sero_shim, service_id: u16, major: u8, now_ms: u32) -> bool;
    pub fn sero_shim_subscribe(
        shim: *mut sero_shim,
        service_id: u16,
        event_id: u16,
        ttl_s: u16,
        now_ms: u32,
    ) -> bool;
    pub fn sero_shim_unsubscribe(shim: *mut sero_shim, service_id: u16, event_id: u16) -> bool;
    pub fn sero_shim_consumer_state(shim: *const sero_shim, service_id: u16) -> c_int;
    pub fn sero_shim_register_service(
        shim: *mut sero_shim,
        service_id: u16,
        major: u8,
        minor: u8,
    ) -> bool;
    pub fn sero_shim_register_event(shim: *mut sero_shim, service_id: u16, event_id: u16) -> bool;
    pub fn sero_shim_offer(shim: *mut sero_shim, service_id: u16, ttl_s: u16, now_ms: u32) -> bool;
    pub fn sero_shim_stop_offer(shim: *mut sero_shim, service_id: u16);
    pub fn sero_shim_notify(
        shim: *mut sero_shim,
        service_id: u16,
        event_id: u16,
        payload: *const u8,
        len: usize,
    ) -> bool;
    pub fn sero_shim_diagnostics(
        shim: *const sero_shim,
        counters: *mut u32,
        capacity: usize,
    ) -> usize;
}
