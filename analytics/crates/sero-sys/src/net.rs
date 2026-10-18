//! IPv4 addresses of local network interfaces (sero needs the address it binds to).

use std::{ffi::CStr, io, net::Ipv4Addr};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interface {
    pub name: String,
    pub addr: Ipv4Addr,
    pub up: bool,
    pub multicast: bool,
    pub loopback: bool,
}

/// Every IPv4 address of every interface.
pub fn interfaces() -> io::Result<Vec<Interface>> {
    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs allocates a list we free below.
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let mut out = Vec::new();
    let mut cur = head;
    while !cur.is_null() {
        // SAFETY: a node of the list returned by getifaddrs.
        let ifa = unsafe { &*cur };
        cur = ifa.ifa_next;
        // SAFETY: ifa_addr may be null; when it is AF_INET it is a sockaddr_in.
        let Some(sa) = (unsafe { ifa.ifa_addr.as_ref() }) else {
            continue;
        };
        if sa.sa_family as i32 != libc::AF_INET {
            continue;
        }
        // SAFETY: AF_INET means sockaddr_in.
        let sin = unsafe { &*ifa.ifa_addr.cast::<libc::sockaddr_in>() };
        let flags = ifa.ifa_flags as i32;
        out.push(Interface {
            // SAFETY: ifa_name is a NUL-terminated string owned by the list.
            name: unsafe { CStr::from_ptr(ifa.ifa_name) }
                .to_string_lossy()
                .into_owned(),
            addr: Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr)),
            up: flags & libc::IFF_UP != 0,
            multicast: flags & libc::IFF_MULTICAST != 0,
            loopback: flags & libc::IFF_LOOPBACK != 0,
        });
    }
    // SAFETY: frees the list from getifaddrs exactly once.
    unsafe { libc::freeifaddrs(head) };
    Ok(out)
}

/// The first IPv4 address of `name`, if the interface exists and is up.
pub fn interface_ipv4(name: &str) -> io::Result<Option<Ipv4Addr>> {
    Ok(interfaces()?
        .into_iter()
        .find(|i| i.name == name && i.up)
        .map(|i| i.addr))
}
