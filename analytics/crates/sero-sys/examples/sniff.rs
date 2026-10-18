//! Subscribes to Sero events and prints everything the runtime reports.
//!
//!   cargo run -p sero-sys --example sniff -- <interface> <service:event>...
//!   cargo run -p sero-sys --example sniff -- eth0 0x0004:0x8001 0x0003:0x8001
//!
//! Uses client id 0x0F10 on unicast port 30499 unless SNIFF_CLIENT_ID / SNIFF_PORT
//! say otherwise, so it can run next to the headunit and kart-agent.

use std::{env, process::exit, sync::mpsc};

use sero_sys::{Event, Handler, Options, net};

struct Print(mpsc::Sender<Event>);

impl Handler for Print {
    fn on_event(&mut self, event: Event) {
        let _ = self.0.send(event);
    }
}

fn hex(s: &str) -> u16 {
    u16::from_str_radix(s.trim_start_matches("0x"), 16).unwrap_or_else(|_| {
        eprintln!("not a hex id: {s}");
        exit(2)
    })
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some((iface, subs)) = args.split_first().filter(|(_, s)| !s.is_empty()) else {
        eprintln!("usage: sniff <interface> <service:event>...");
        exit(2)
    };
    let subs: Vec<(u16, u16)> = subs
        .iter()
        .map(|s| {
            let (svc, evt) = s.split_once(':').unwrap_or_else(|| {
                eprintln!("expected service:event, got {s}");
                exit(2)
            });
            (hex(svc), hex(evt))
        })
        .collect();
    let ip = net::interface_ipv4(iface)
        .expect("listing interfaces")
        .unwrap_or_else(|| {
            eprintln!("{iface} has no IPv4 address or is down");
            exit(1)
        });
    let env_u16 = |key, default| env::var(key).ok().map_or(default, |v: String| hex(&v));
    let options = Options::new(
        ip,
        env::var("SNIFF_PORT").map_or(30499, |p| p.parse().expect("SNIFF_PORT")),
        env_u16("SNIFF_CLIENT_ID", 0x0F10),
    );

    let (tx, rx) = mpsc::channel();
    let thread = sero_sys::spawn(options, Box::new(Print(tx)), move |rt, now| {
        let mut services: Vec<u16> = subs.iter().map(|&(s, _)| s).collect();
        services.dedup();
        for s in services {
            rt.find(s, 1, now);
        }
        for (s, e) in subs {
            rt.subscribe(s, e, 15, now);
        }
        Ok(())
    })
    .expect("starting sero");
    eprintln!("listening on {}", thread.local_addr());
    for event in rx {
        match event {
            Event::Notification {
                service,
                event,
                payload,
                rx_unix_us,
            } => {
                let bytes: Vec<String> = payload.iter().map(|b| format!("{b:02X}")).collect();
                println!(
                    "{rx_unix_us} 0x{service:04X}:0x{event:04X} [{}] {}",
                    payload.len(),
                    bytes.join(" ")
                );
            }
            other => println!("{other:?}"),
        }
    }
}
