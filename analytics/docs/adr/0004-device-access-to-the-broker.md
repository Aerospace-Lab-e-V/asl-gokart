# ADR-0004: Device access to the broker through the border Nginx

## Status
Accepted. Replaces the "mTLS and WireGuard" follow-up of [ADR-0001](0001-kart-agent-integration.md) and the WireGuard
network in the README.

## Date
2026-11-27

## Context
Karts (kart-agent) and the trackside timing device (the speedcamera's kartlink plugin) publish to Mosquitto in the
analytics VM. Today they connect with plain MQTT on port 1883 inside the lab. That stops working once they are on an
LTE or phone hotspot outside the lab.

Constraints:

- **The lab's entry point is the admins' Nginx at the DMZ border.** It terminates TLS for all public sites with
  wildcard certificates on 443. We don't want to open another port such as 8883.
- **Filtering happens outside the VM**, in the Proxmox VM firewall or the DMZ firewall
  ([deploy/vm/README.md](../../deploy/vm/README.md) §1.2).
- **Unauthenticated clients from the internet must not reach the broker.**
- **The broker's ACLs need each device's identity.** Only `command-api` may publish `cmd` and `profile`, and the
  timing device only `laps`. A kart must not publish into another kart's topics: `cmd/ack` and `profile` decide a
  kart's limits ([ADR-0003](0003-driver-profiles-and-remote-limits.md)).
- **The kart dials out** and has no open ports. Setup happens from the headunit UI, without SSH
  ([ADR-0001](0001-kart-agent-integration.md)).
- **Both clients are Rust with rumqttc 0.25** (`crates/kart-mqtt`; the speedcamera's
  `headless-rust/src/plugins/kartlink`). rumqttc supports MQTT over WebSocket and TLS with a client certificate
  (`websocket` feature, `Transport::Wss` with `client_auth`).
- **There is no management interface for engineers and admins yet.** It will sit behind Keycloak (the lab SSO) from
  the start and stays internal until then. Its architecture, tech stack and requirements are decided separately.

The earlier plan was a WireGuard tunnel from each device to the VM plus mTLS at the broker.

## Decision

### Path from the device to the broker
```
kart-agent / speedcamera
  └─ wss://<DEVICE_HOST>/mqtt with a client certificate from our device CA
     border Nginx (lab admins): wildcard certificate; /mqtt only with a verified client certificate, otherwise 403
       └─ plain WebSocket inside the DMZ
          VM :9002  Mosquitto listener for devices; the Proxmox firewall admits only the border Nginx
            MQTT login with the device's own user and password → ACLs
```

- **Device listener.** Mosquitto gets a WebSocket listener on 9002 for devices only. It is separate from the browser
  listener on 9001, which the pit wall reaches through Caddy.
- **Internal listener.** ingest and command-api keep using 1883 inside the compose network. 1883 is no longer
  published on the VM.
- **Server certificate.** Devices see the admins' wildcard certificate and verify it against the public CA roots, not
  against our device CA.
- **TLS ends at the border.** The hop from the border Nginx to the VM is plain WebSocket inside the DMZ, like the
  admins' other backends.

### The certificate is the gate, the broker login is the identity
- **Gate.** The border Nginx only checks that the client certificate was issued by our device CA. Open-source nginx
  cannot pass the certificate's identity on to the broker (it only sends PROXY protocol v1, which carries the address
  and port), so Mosquitto never sees the certificate.
- **Identity.** Each device gets its own broker user and password in the same enrollment step as its certificate.
  The user name equals the certificate's common name: the kart ID for a kart, `speedcamera-<device_id>` for a timing
  device. Mosquitto's ACLs check that user. The internal user names (`ingest`, `command-api`, `pit-wall`) and the
  `speedcamera-` prefix cannot be assigned to karts.
- **Where users live.** Users and roles move from the password file into Mosquitto's dynamic security plugin. The
  enrollment service creates and disables device users through the plugin's MQTT control topic, without editing files
  or reloading the broker. Each device user is pinned to its client ID (`kart-agent-<kart_id>`,
  `speedcamera-<device_id>`), and so is `ingest`. The internal users move into the plugin too.
- **Pinning only binds the pinned user.** It does not reserve the client ID: tested against Mosquitto 2.0.22, an
  unpinned user that connects with another client's ID still takes over its session. Every user except `pit-wall` is
  pinned. `pit-wall` cannot be (browsers choose random client IDs), and its password is in the pit wall's public
  `/config.json`, so whoever can open the pit wall can disconnect any client. That is one more reason to keep the pit
  wall on the lab network and VPN until Keycloak is in front; per-user browser logins close it then.
- **Revocation.** Disabling a device's broker user takes effect immediately. The border Nginx gets no revocation
  list: a revoked device still passes the gate but cannot log in.

Device rights (internal users as in the README's MQTT topic table):

| User | Publishes | Subscribes |
|---|---|---|
| kart `<kart_id>` | `kart/<kart_id>/{live,backfill,alerts,status,cmd/ack,driver}` | `kart/<kart_id>/{cmd,profile}` |
| timing device `speedcamera-<device_id>` | `kart/+/laps` | `kart/+/live`, `kart/+/status` |

### Device certificates
- **Our own device CA**, used only for device client certificates. Its key is root-only on the VM under
  `/etc/kart-analytics/device-ca/` and never enters Git. The CA certificate is public and is also installed on the
  border Nginx.
- **The device generates its key**, which never leaves the device, and sends a certificate signing request.
- **The certificate** carries the ID the admin approved as its common name, not whatever the request asked for. It is
  for client authentication only and valid for one year.
- **The signer is a small service of our own** in the analytics workspace (`crates/enroll`, Rust and axum like
  pit-api; wire format in `crates/enroll-proto`). It creates the broker user and signs the certificate in one step.
  Its admin API listens on loopback inside its container only; the VM's `kart-enroll` command runs the CLI there.

### Enrollment
1. **Request.** The user taps *Enroll*: on the headunit's Telemetry page (through kart-agent's local API), or in the
   speedcamera's kart link settings. The device generates its key and signing request and sends them, with the
   requested device type and ID, to `/enroll`. The service answers with a random code that it generates itself, that
   works once and expires after 10 minutes. The device shows the code.
2. **Approve.** An admin approves the request whose code matches the device's screen and assigns the ID. Approval
   creates the broker user and role and signs the certificate.
3. **Connect.** The device polls, receives its certificate and broker password, and stores them (kart-agent: in its
   state directory). It takes its ID from the certificate and connects.

Phases:

- **Phase 1 (now): internal only.** The border Nginx admits `/enroll` only from the lab network and the VPN, so a
  device must be on the lab network to enroll. Admins approve with a CLI in the `enroll` container on the VM
  (`docker compose exec`, over SSH). There is no management UI.
- **Phase 2: the management interface.** The management interface for engineers and admins, behind Keycloak from the
  start, takes over approval through the same service. `/enroll` is then open from anywhere. The public side can only
  queue requests; issuing a certificate still needs an approval.

`/enroll` goes through the border Nginx even in phase 1. Its answer contains the broker password, so it needs TLS, and
the wildcard certificate provides that. Devices use the same URL in both phases. Phase 2 only removes the IP
restriction.

### Border Nginx (requested from the lab admins)
```nginx
server {
    listen 443 ssl;
    server_name <DEVICE_HOST>;
    # the admins' wildcard certificate as usual
    ssl_client_certificate /etc/nginx/kart-device-ca.pem;  # our device CA certificate (public)
    ssl_verify_client optional;                             # /enroll must work without a certificate

    location /mqtt {
        if ($ssl_client_verify != SUCCESS) { return 403; }
        proxy_pass http://<VM_IP>:9002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /enroll/ {
        allow <LAB_NET>;   # phase 1 only; removed in phase 2
        allow <VPN_NET>;
        deny all;
        proxy_pass http://<VM_IP>:8082;
    }
}
```
`/enroll` also needs a request rate limit and a small body limit. On the VM side, the Proxmox firewall admits 9002 and
8082 only from the border Nginx.

### Pit wall until Keycloak
The pit wall's `/config.json` hands the read-only broker login to anyone who opens the page, and Caddy forwards
`/mqtt` to the broker. Until Keycloak is in front, the border Nginx admits the pit wall and Grafana only from the lab
network and the VPN. Otherwise the broker is reachable from the internet through the browser path and all live data
is readable, whatever the device path does.

## Alternatives considered

### mTLS at Mosquitto on port 8883
- Pros: the certificate's identity becomes the broker user (`use_identity_as_username`), so one credential per device;
  works with Mosquitto 2.0.
- Cons: a second public port next to the border Nginx; Mosquitto, which is single-threaded, faces the internet
  directly.
- Rejected: everything public enters through the border Nginx on 443.

### SNI passthrough on 443 with mTLS at Mosquitto
- Pros: the same single credential as above, on 443 (`stream` + `ssl_preread` routes by host name without decrypting).
- Cons: the admins would have to put a `stream` block in front of all their HTTPS sites and move those to an internal
  port. Mosquitto would need its own server certificate.
- Rejected: too invasive for a shared border proxy. Worth revisiting if the admins ever run `stream` on 443 anyway.

### TLS at the border, identity passed on in PROXY protocol v2
- Pros: Mosquitto 2.1 can take the certificate's common name from a PROXY v2 header (documented with HAProxy's
  `send-proxy-v2-ssl-cn`), which would keep a single credential with TLS at the border.
- Cons: the admins run nginx, which only sends PROXY v1. It would need Mosquitto 2.1. Anyone who reaches a PROXY
  listener directly can claim any identity.
- Rejected.

### WireGuard tunnel to the VM (the previous plan)
- Pros: the broker is invisible to the internet; the tunnel would also carry later protocols (SSH, video).
- Cons:
  - It only protects the transport; the broker still needs per-device credentials.
  - It needs a UDP port forward through the lab firewall.
  - It needs root network configuration on the Pi, outside kart-agent's systemd sandbox, and the same on the
    speedcamera.
  - It brings its own key registration.
- Rejected for MQTT. It remains an option for remote maintenance or video later.

### MQTT over WSS with per-device passwords only
- Pros: simplest; one credential.
- Cons: no gate. The broker's login is reachable from the internet and passwords can be guessed.
- Rejected.

### Keep the password file
- Pros: already in use; no plugin.
- Cons: the enrollment service would have to edit the file and reload the broker, which needs access to the broker
  container. No pinning of users to client IDs.
- Rejected in favour of the dynamic security plugin.

### step-ca as the CA
- Pros: a maintained CA with renewal, revocation and ACME.
- Cons: its enrollment is built on one-time tokens (JWTs) that would have to get onto the headunit; approval by code
  is not built in; one more service to run.
- Rejected for now. The signing policy (which ID, which usage, how long) is ours either way.

## Consequences
- **Two credentials per device, not bound to each other.** Accepted: they are issued together and stored together, so
  whoever steals a device has both and can only act as that device. A device with its own certificate and another
  device's broker password could act as that other device. That needs the password to leak from somewhere other than
  the device.
- **The firewall rule for 9002 is what makes the gate work.** Anything other than the border Nginx that reaches the
  device listener bypasses the certificate check.
- **Broker passwords cross the DMZ in plain text** between the border Nginx and the VM. The hop can be re-encrypted
  later if that matters.
- **We depend on the lab admins** for the vhost, the CA certificate on their Nginx, the phase-1 IP restriction and its
  removal. Replacing the device CA means a new CA file on their Nginx.
- **The CA key sits on the VM.** If the VM is compromised, replace the CA and re-enroll every device.
- **Clients.**
  - kart-mqtt and the speedcamera's kartlink plugin switch to rumqttc's `websocket` feature with rustls. Planned:
    `use-rustls-no-provider` plus the `ring` provider, to avoid building aws-lc's C code under `cargo zigbuild`; not
    tried yet.
  - The broker URL becomes `wss://<DEVICE_HOST>/mqtt`.
  - The speedcamera's username and password settings are replaced by enrollment.
  - Once enrolled, kart-agent takes `kart_id` from its certificate; the configured value no longer applies.
- **Clock.** Certificate checks need a roughly correct clock, and the Pi has no RTC. After a long time switched off,
  the first connection can fail until NTP has synced. The agent's status already reports clock sync; the Telemetry
  page should show it as the reason.
- **Enrollment needs the lab network until phase 2.**
- **Latency.** No cost per message. A reconnect takes TCP, the TLS 1.3 handshake, the WebSocket upgrade and MQTT
  CONNECT: about four LTE round trips. The hops from the border Nginx to the broker stay inside the DMZ.
- **Open with the admins:** whether devices on the lab network reach the border Nginx under `<DEVICE_HOST>`. Phase 1
  assumes they do.
- **Disabling a device** with the plugin disconnects it at once if it is connected (tested).
- Follow-ups:
  - certificate renewal before expiry (design open); until then re-enroll with `--replace`
  - the management interface (planned separately) and Keycloak in front of the pit wall and Grafana
  - a cross-build of kart-agent with `ring` under `cargo zigbuild` on CI (the first one comes with this change)
