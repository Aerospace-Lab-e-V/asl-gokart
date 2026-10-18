use std::{
    io,
    net::SocketAddrV4,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU32, AtomicU64, Ordering},
        mpsc,
    },
    thread::JoinHandle,
    time::Instant,
};

use crate::{Event, Handler, Options, Runtime};

/// Milliseconds on a process-wide monotonic clock, as sero expects (wraps after ~49 days).
pub fn now_ms() -> u32 {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u32
}

/// Work for a runtime running on a [`SeroThread`]. Failures are reported to the
/// handler as [`Event::CommandFailed`].
#[derive(Debug, Clone)]
pub enum Command {
    Find {
        service: u16,
        major: u8,
    },
    Subscribe {
        service: u16,
        event: u16,
        ttl_s: u16,
    },
    Unsubscribe {
        service: u16,
        event: u16,
    },
    Notify {
        service: u16,
        event: u16,
        payload: Vec<u8>,
    },
}

/// Upper bound for how long the thread sleeps without traffic, so timers (offers,
/// renewals, TTLs) keep running.
const POLL_TIMEOUT_MS: i32 = 10;

struct Shared {
    heartbeat_ms: AtomicU64,
    counters: [AtomicU32; 9],
}

/// A [`Runtime`] on its own thread. Dropping it shuts the thread down.
pub struct SeroThread {
    tx: Option<mpsc::Sender<Command>>,
    wake: Arc<OwnedFd>,
    join: Option<JoinHandle<()>>,
    shared: Arc<Shared>,
    local_addr: SocketAddrV4,
}

/// Starts a runtime on a new thread. `setup` runs on that thread before the loop
/// (register and offer services, find and subscribe); its error is returned here.
pub fn spawn<S>(
    options: Options,
    handler: Box<dyn Handler + Send>,
    setup: S,
) -> io::Result<SeroThread>
where
    S: FnOnce(&mut Runtime, u32) -> io::Result<()> + Send + 'static,
{
    // SAFETY: plain syscall; the fd is owned below.
    let fd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: freshly created, owned by nobody else.
    let wake = Arc::new(unsafe { OwnedFd::from_raw_fd(fd) });
    let shared = Arc::new(Shared {
        heartbeat_ms: AtomicU64::new(now_ms() as u64),
        counters: Default::default(),
    });
    let (tx, rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);

    let join = {
        let (wake, shared) = (wake.clone(), shared.clone());
        std::thread::Builder::new()
            .name(format!("sero-{:04x}", options.client_id))
            .spawn(move || {
                let mut rt = match Runtime::new(&options, handler) {
                    Ok(rt) => rt,
                    Err(e) => return drop(ready_tx.send(Err(e))),
                };
                if let Err(e) = setup(&mut rt, now_ms()) {
                    return drop(ready_tx.send(Err(e)));
                }
                let _ = ready_tx.send(Ok(rt.local_addr()));
                run(rt, rx, &wake, &shared);
            })?
    };
    let local_addr = ready_rx
        .recv()
        .map_err(|_| io::Error::other("sero thread died during start-up"))??;
    Ok(SeroThread {
        tx: Some(tx),
        wake,
        join: Some(join),
        shared,
        local_addr,
    })
}

fn run(mut rt: Runtime, rx: mpsc::Receiver<Command>, wake: &OwnedFd, shared: &Shared) {
    let mut fds: Vec<libc::pollfd> = rt
        .fds()
        .into_iter()
        .chain([wake.as_raw_fd()])
        .map(|fd| libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        })
        .collect();
    loop {
        // SAFETY: valid pollfd array of the given length.
        unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, POLL_TIMEOUT_MS) };
        let mut buf = [0u8; 8];
        // SAFETY: drains the non-blocking eventfd counter into an 8-byte buffer.
        unsafe { libc::read(wake.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len()) };
        for fd in &mut fds {
            fd.revents = 0;
        }

        loop {
            match rx.try_recv() {
                Ok(cmd) => execute(&mut rt, cmd),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    // Flush what the last commands queued (e.g. unsubscribes).
                    rt.process(now_ms());
                    return;
                }
            }
        }
        rt.process(now_ms());

        shared
            .heartbeat_ms
            .store(now_ms() as u64, Ordering::Relaxed);
        for (slot, value) in shared.counters.iter().zip(rt.diagnostics()) {
            slot.store(value, Ordering::Relaxed);
        }
    }
}

fn execute(rt: &mut Runtime, cmd: Command) {
    let now = now_ms();
    let (ok, command, service, id) = match cmd {
        Command::Find { service, major } => (rt.find(service, major, now), "find", service, 0),
        Command::Subscribe {
            service,
            event,
            ttl_s,
        } => (
            rt.subscribe(service, event, ttl_s, now),
            "subscribe",
            service,
            event,
        ),
        Command::Unsubscribe { service, event } => (
            rt.unsubscribe(service, event),
            "unsubscribe",
            service,
            event,
        ),
        // No subscriber is normal for a provider, not a failure.
        Command::Notify {
            service,
            event,
            payload,
        } => {
            rt.notify(service, event, &payload);
            (true, "notify", service, event)
        }
    };
    if !ok {
        rt.report(Event::CommandFailed {
            command,
            service,
            id,
        });
    }
}

impl SeroThread {
    /// Queues a command; `false` if the thread is gone.
    pub fn send(&self, cmd: Command) -> bool {
        let Some(tx) = &self.tx else { return false };
        if tx.send(cmd).is_err() {
            return false;
        }
        let one = 1u64.to_ne_bytes();
        // SAFETY: writes 8 bytes to our eventfd to wake the poll.
        unsafe { libc::write(self.wake.as_raw_fd(), one.as_ptr().cast(), one.len()) };
        true
    }

    pub fn local_addr(&self) -> SocketAddrV4 {
        self.local_addr
    }

    /// [`now_ms`] at the end of the last loop iteration; stale means the thread hangs.
    pub fn heartbeat_ms(&self) -> u32 {
        self.shared.heartbeat_ms.load(Ordering::Relaxed) as u32
    }

    pub fn is_running(&self) -> bool {
        self.join.as_ref().is_some_and(|j| !j.is_finished())
    }

    /// Diagnostic counters as of the last loop iteration (see [`crate::DIAGNOSTIC_COUNTERS`]).
    pub fn diagnostics(&self) -> [u32; 9] {
        std::array::from_fn(|i| self.shared.counters[i].load(Ordering::Relaxed))
    }

    /// Runs queued commands, then stops the thread and waits for it.
    pub fn shutdown(mut self) {
        self.stop();
    }

    fn stop(&mut self) {
        // Disconnecting the channel is the stop signal.
        drop(self.tx.take());
        let one = 1u64.to_ne_bytes();
        // SAFETY: as in `send`.
        unsafe { libc::write(self.wake.as_raw_fd(), one.as_ptr().cast(), one.len()) };
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl Drop for SeroThread {
    fn drop(&mut self) {
        self.stop();
    }
}
