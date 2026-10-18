//! The compiled shim matches what the Rust side and the wire format assume.

#[test]
fn shim_info() {
    let info = sero_sys::info();
    assert_eq!(info.abi_version, 1);
    // Part of the wire format: SD offers carry an 8-byte transport address.
    assert_eq!(info.transport_addr_size, 8);
    assert_eq!(info.seq_accept_window, 255);
    assert_eq!(
        info.diagnostic_counters as usize,
        sero_sys::DIAGNOSTIC_COUNTERS.len()
    );
}

#[test]
fn invalid_bind_address_is_an_error() {
    struct Ignore;
    impl sero_sys::Handler for Ignore {
        fn on_event(&mut self, _: sero_sys::Event) {}
    }
    // An address that is not on any local interface.
    let opts = sero_sys::Options::new("192.0.2.123".parse().unwrap(), 0, 0x0010);
    let err = sero_sys::Runtime::new(&opts, Box::new(Ignore))
        .err()
        .expect("binding to a foreign address must fail");
    assert_eq!(err.raw_os_error(), Some(libc::EADDRNOTAVAIL));
}
