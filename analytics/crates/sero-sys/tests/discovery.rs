//! A provider and a consumer in one process find each other and exchange an event
//! over real sockets, on a private multicast group so no real ECU is involved.

use std::{
    net::Ipv4Addr,
    sync::mpsc,
    time::{Duration, Instant},
};

use sero_sys::{Command, Event, Handler, Options, net};

const SERVICE: u16 = 0x0042;
const EVENT: u16 = 0x8001;

struct Forward(mpsc::Sender<Event>);

impl Handler for Forward {
    fn on_event(&mut self, event: Event) {
        let _ = self.0.send(event);
    }
}

struct Ignore;

impl Handler for Ignore {
    fn on_event(&mut self, _: Event) {}
}

fn options(ip: Ipv4Addr, client_id: u16) -> Options {
    Options {
        mcast_group: Ipv4Addr::new(239, 255, 77, 1),
        mcast_port: 41_000 + (std::process::id() % 1000) as u16,
        ..Options::new(ip, 0, client_id)
    }
}

#[test]
fn provider_and_consumer_exchange_an_event() {
    let Some(iface) = net::interfaces()
        .unwrap()
        .into_iter()
        .find(|i| i.up && i.multicast && !i.loopback)
    else {
        eprintln!("skipped: no multicast-capable IPv4 interface");
        return;
    };

    let provider = sero_sys::spawn(options(iface.addr, 0x0F01), Box::new(Ignore), |rt, now| {
        assert!(rt.register_service(SERVICE, 1, 0));
        assert!(rt.register_event(SERVICE, EVENT));
        assert!(rt.offer(SERVICE, 10, now));
        Ok(())
    })
    .unwrap();

    let (tx, rx) = mpsc::channel();
    let consumer = sero_sys::spawn(
        options(iface.addr, 0x0010),
        Box::new(Forward(tx)),
        |rt, now| {
            assert!(rt.find(SERVICE, 1, now));
            assert!(rt.subscribe(SERVICE, EVENT, 15, now));
            Ok(())
        },
    )
    .unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    let (mut found, mut acked) = (false, false);
    let notification = loop {
        assert!(
            Instant::now() < deadline,
            "no notification (found: {found}, acked: {acked})"
        );
        provider.send(Command::Notify {
            service: SERVICE,
            event: EVENT,
            payload: vec![1, 2, 3],
        });
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Event::ServiceFound {
                service,
                provider: addr,
            }) => {
                assert_eq!(service, SERVICE);
                assert_eq!(addr, provider.local_addr());
                found = true;
            }
            Ok(Event::SubscriptionAck { return_code, .. }) => {
                assert_eq!(return_code, sero_sys::rc::E_OK);
                acked = true;
            }
            Ok(n @ Event::Notification { .. }) => break n,
            Ok(_) | Err(_) => {}
        }
    };

    let Event::Notification {
        service,
        event,
        payload,
        rx_unix_us,
    } = notification
    else {
        unreachable!()
    };
    assert_eq!(
        (service, event, payload.as_slice()),
        (SERVICE, EVENT, &[1, 2, 3][..])
    );
    let now_us = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_micros() as i64;
    assert!(
        (now_us - rx_unix_us).abs() < 1_000_000,
        "receive time is off"
    );
    assert!(found && acked);

    consumer.shutdown();
    provider.shutdown();
}
