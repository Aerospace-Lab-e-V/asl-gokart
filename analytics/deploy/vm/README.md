# Production host: Debian 13 VM on Proxmox VE

The analytics stack runs with Docker Compose inside a Debian 13 VM on a Proxmox VE node in the DMZ. Deploys are **pull-based**: CI publishes images to GHCR, and a systemd timer on the VM fetches and starts new releases.

**Why a VM and not an LXC container:** a container shares the Proxmox host's kernel. A Docker or kernel escape out of a container in the DMZ would therefore land on the hypervisor itself. A VM has its own kernel, so an attacker would also have to break out of KVM/QEMU. The lab admins require a VM for anything that runs Docker in the DMZ.

```
git tag analytics-vX.Y.Z ─► CI (ci-analytics-release.yml): checks → kart-ingest, kart-pit-api, kart-pit-wall → kart-analytics-deploy
                                                                         ghcr.io/aerospace-lab-e-v/<image>:X.Y.Z
VM: kart-analytics-update.timer (every 5 min)
   newest stable X.Y.Z of kart-analytics-deploy (or PIN_VERSION)
   → extract the bundle to /opt/kart-analytics/releases/X.Y.Z
   → pg_dump → docker compose pull → up --wait
   → healthy: record version, prune old releases │ not healthy: start the previous release again
```

The deploy bundle (`deploy/bundle.Dockerfile`) carries the compose files, broker config, Grafana provisioning and this directory. It never contains secrets.


| Path on the VM | What |
|---|---|
| `/etc/kart-analytics/.env` | secrets for compose (from `deploy/compose/.env.example`) |
| `/etc/kart-analytics/pit-wall.config.json` | read-only broker login for browsers (from `deploy/compose/pit-wall.config.example.json`) |
| `/etc/kart-analytics/device-ca/` | the device CA (`ca.key`, `ca.pem`), owned by uid 10082 (the enroll container), see section 6 |
| `/etc/kart-analytics/update.conf` | updater settings (from `update.conf.example`) |
| `/opt/kart-analytics/releases/<version>` | extracted bundles; `/opt/kart-analytics/current` points at the running one |
| `/var/lib/kart-analytics/current-version` | the deployed version (`failed-version`: last failed deploy) |
| `/var/backups/kart-analytics/` | `pg_dump` taken before every deploy |
| Docker volumes `kart-analytics_*` | database, Grafana, broker data (incl. `dynamic-security.json`: broker users and ACLs) and the enroll service's issue log |

---

## 1. Create the VM (Proxmox host)

Check first:
- **Storage for the VM disk**: ask the lab admins which storage VMs go on. It has to allow the *Disk image* content type. `local` usually doesn't, and that's intended.
- **Outbound HTTPS** from the VM's network to `ghcr.io` and `pkg-containers.githubusercontent.com` (image pulls), and to the Debian and Docker apt mirrors.
- **Inbound**: decide with the lab admins where the port rules live (section 1.2). They have to sit outside the VM.

### 1.1 Install Debian 13 from the netinst ISO

1. **ISO**: *local → ISO Images → Download from URL* with the `debian-13.*-amd64-netinst.iso` link from [debian.org](https://www.debian.org/CD/netinst/). Paste its SHA512 from the `SHA512SUMS` file next to it into the checksum field. Alternatively copy the ISO to `/var/lib/vz/template/iso/` on the node.
2. **Create VM** wizard:

   | Tab | Setting |
   |---|---|
   | General | name `<HOSTNAME>`, *Start at boot* on |
   | OS | the netinst ISO, type Linux |
   | System | *Qemu Agent* on, SCSI controller *VirtIO SCSI single* (defaults otherwise) |
   | Disks | 32 GB on the storage the admins named, *Discard* and *IO thread* on |
   | CPU / Memory | 2 cores, 4096 MB |
   | Network | VirtIO, bridge `<BRIDGE>`, VLAN tag `<VLAN_TAG>`, *Firewall* on |

3. **Installer** (console of the VM):
   - Network: configure by hand with `<VM_IP>/<PREFIX>`, gateway `<GATEWAY>`, DNS `<DNS_SERVER>`, hostname and domain.
   - **Leave the root password empty.** Root login is then locked and the first user (`<ADMIN_USER>`) gets `sudo`, which the rest of this guide assumes.

     If you did set a root password, the installer gives your user no `sudo` (and may not install it), and SSH still refuses root's password (`Failed password for root` in `journalctl -u ssh`, even when it is correct). Fix it as root in the Proxmox console: `apt install -y sudo`, then `adduser <ADMIN_USER>` if no user exists yet, then `usermod -aG sudo <ADMIN_USER>`. Once `sudo` works for that user, lock root with `passwd -l root`.
   - Partitioning: *Guided – use entire disk and set up LVM*, *All files in one partition*. LVM makes growing the disk later simple (see below).
   - Software selection: only **SSH server** and **standard system utilities**. No desktop environment.
4. After the first boot, detach the ISO (*Hardware → CD/DVD Drive → Do not use any media*) and switch to key-only SSH:

   ```bash
   ssh-copy-id <ADMIN_USER>@<HOSTNAME>          # from your machine
   # on the VM, after key login works:
   echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/10-keys-only.conf
   sudo systemctl reload ssh
   ```

- 32 GB is a starting point for TimescaleDB plus images. To grow it, add a second disk to the VM (*Hardware → Add → Hard Disk*) and extend the volume group: `pvcreate /dev/sdb && vgextend <VG> /dev/sdb && lvextend -r -l +100%FREE /dev/<VG>/root` (`vgs` shows the VG name).
- Lab admins: add a DNS record for the VM and include it in the scheduled `vzdump` backups.

<details>
<summary>Alternative: Debian cloud image via the CLI (needs root on the Proxmox node)</summary>

Debian's cloud image is a ready-made disk, configured with cloud-init. It is imported as the VM's disk, not booted like an ISO, so the GUI's ISO picker doesn't list it.

```bash
cd /var/lib/vz/template/iso
wget https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2
wget https://cloud.debian.org/images/cloud/trixie/latest/SHA512SUMS
sha512sum --ignore-missing -c SHA512SUMS

qm create <VMID> --name <HOSTNAME> --ostype l26 \
  --cores 2 --memory 4096 \
  --scsihw virtio-scsi-single \
  --scsi0 <STORAGE>:0,import-from=/var/lib/vz/template/iso/debian-13-genericcloud-amd64.qcow2,discard=on,iothread=1 \
  --ide2 <STORAGE>:cloudinit \
  --boot order=scsi0 \
  --net0 virtio,bridge=<BRIDGE>,tag=<VLAN_TAG>,firewall=1 \
  --serial0 socket --vga serial0 \
  --agent enabled=1 \
  --onboot 1
qm disk resize <VMID> scsi0 32G

qm set <VMID> --ciuser <ADMIN_USER> --sshkeys <ADMIN_KEYS_FILE> \
  --ipconfig0 ip=<VM_IP>/<PREFIX>,gw=<GATEWAY> \
  --nameserver <DNS_SERVER> --searchdomain <SEARCH_DOMAIN>
qm start <VMID>
```

The image has no root password and no SSH password login; log in as `<ADMIN_USER>` with your key. The console is the serial terminal (`qm terminal <VMID>`). It grows its root partition by itself after `qm disk resize <VMID> scsi0 +<N>G` and a reboot.

</details>

### 1.2 Firewall: outside the VM

Docker writes its own nftables/iptables rules for published ports, and they **bypass** `ufw` or any INPUT rules inside the VM. Filtering inbound traffic inside the guest therefore doesn't work, and an attacker who got root on the VM could remove it anyway. Filter in front of the VM instead: in the DMZ firewall or in the Proxmox VM firewall (`firewall=1` on `net0` above). A Proxmox example, `/etc/pve/firewall/<VMID>.fw`:

```
[OPTIONS]
enable: 1
policy_in: DROP
policy_out: ACCEPT

[RULES]
IN SSH(ACCEPT) -source <ADMIN_NET>
IN ACCEPT -source <TEAM_NET> -p tcp -dport 3000 # Grafana
IN ACCEPT -source <TEAM_NET> -p tcp -dport 8080 # pit wall
# Devices (ADR-0004): only the border Nginx, which checks the device certificates.
IN ACCEPT -source <BORDER_NGINX_IP> -p tcp -dport 9002 # device MQTT (WebSocket)
IN ACCEPT -source <BORDER_NGINX_IP> -p tcp -dport 8082 # enrollment requests
IN ACCEPT -source <BORDER_NGINX_IP> -p tcp -dport 8080 # pit wall at https://<DEVICE_HOST>/
```

The two device rules are what makes the certificate check work: anything else that reaches 9002 talks to the broker without passing Nginx. The border Nginx serves the pit wall only to the lab network and VPN (section 6.2); keep 3000 and 8080 limited to those networks as well until Keycloak is in front.

The VM firewall only filters if the firewall is also enabled at datacenter level. Check with the admins whether `policy_out` should be restricted to the destinations listed above.

## 2. Prepare the VM

Log in with `ssh <ADMIN_USER>@<HOSTNAME>`, then run everything as root (`sudo -i`):

```bash
apt update && apt full-upgrade -y
apt install -y ca-certificates curl jq qemu-guest-agent unattended-upgrades
systemctl enable --now qemu-guest-agent    # lets vzdump freeze the filesystem for backups

# Docker CE from Docker's repository (https://docs.docker.com/engine/install/debian/)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Rotate container logs (the default json-file driver grows without limit).
echo '{ "log-driver": "local" }' > /etc/docker/daemon.json
systemctl restart docker

docker info | grep -E 'Storage Driver|Cgroup'   # expect overlayfs (or overlay2) and cgroup v2
docker run --rm hello-world
```

Hardening that matters in the DMZ:
- Don't add anyone to the `docker` group. Access to the Docker socket is equivalent to root. Admins use `sudo`.
- Keep SSH key-only (step 1.1, item 4). Check with `sshd -T | grep -E 'passwordauthentication|permitrootlogin'`.
- `unattended-upgrades` installs Debian security updates. Docker's packages come from Docker's repository, so update them with `apt upgrade` from time to time. Reboot for kernel updates (`/run/reboot-required` exists when one is pending). The stack restarts by itself after a reboot.

## 3. Install the updater

Take the updater from the release you want to run first:

```bash
V=<VERSION>    # e.g. the newest release, without the analytics-v prefix
docker create --name bundle ghcr.io/aerospace-lab-e-v/kart-analytics-deploy:$V /bundle
docker cp bundle:/bundle /root/bundle-$V && docker rm bundle
/root/bundle-$V/deploy/vm/install.sh     # script, units, /etc/kart-analytics/update.conf; enables the timer
```

Releases up to 0.1.0 have this directory at `deploy/lxc/`. The scripts in it are the same.

If the GHCR packages are private, first `docker login ghcr.io` with a token that has `read:packages`, and set `REGISTRY_AUTH=<user>:<token>` in `update.conf`. Making the packages public is simpler, since the repo is public anyway: on GitHub, open each package → *Package settings* → *Change visibility*.

When a release changes the updater or its units, run `install.sh` from that release's directory again: `/opt/kart-analytics/current/deploy/vm/install.sh`.

## 4. Secrets

All of these are root-only (`chmod 600`) and never leave the VM.

```bash
cd /etc/kart-analytics
cp /root/bundle-$V/deploy/compose/.env.example .env              # fill in; generate with: openssl rand -hex 24
cp /root/bundle-$V/deploy/compose/pit-wall.config.example.json pit-wall.config.json

# pit-wall.config.json: mqttPassword = PIT_WALL_MQTT_PASSWORD from .env
chmod 600 .env pit-wall.config.json update.conf
```

Broker users live in Mosquitto's dynamic security plugin, not in a file (ADR-0004). On its first start the broker creates the plugin's file with the admin user `dynsec-admin` (`MQTT_DYNSEC_ADMIN_PASSWORD`); the enroll service then creates the `ingest` and `pit-wall` users from `.env` and keeps them in sync on every start. Changing `INGEST_MQTT_PASSWORD` or `PIT_WALL_MQTT_PASSWORD` therefore only needs a redeploy; changing the admin password needs `mosquitto_ctrl` in the broker container as well (`setClientPassword dynsec-admin`).

The database passwords take effect only when the database volume is created on the first start. Changing them later means `ALTER ROLE … PASSWORD` in the database as well.

The device CA (section 6) has to exist before the first deploy of a release with the enroll service; without it the service does not start and the updater rolls back.

## 5. First deploy

```bash
systemctl start kart-analytics-update.service
journalctl -u kart-analytics-update -f
docker compose -p kart-analytics ls && docker ps
```

Then open Grafana at `http://<HOSTNAME>:3000` and the pit wall at `http://<HOSTNAME>:8080`.

## 6. Device access: CA, border Nginx, enrollment (ADR-0004)

Karts and timing devices connect to `wss://<DEVICE_HOST>/mqtt` through the lab's border Nginx, which only forwards clients with a certificate from our device CA. Each device also logs in to the broker as its own user. Both come from enrollment: the device asks, an admin approves by the code the device shows.

### 6.1 Create the device CA (once)

```bash
V=<VERSION>   # the release about to be deployed
install -d -o 10082 -g 10082 -m 700 /etc/kart-analytics/device-ca
docker run --rm -v /etc/kart-analytics/device-ca:/device-ca \
    ghcr.io/aerospace-lab-e-v/kart-enroll:$V init-ca > /root/kart-device-ca.pem
```

`ca.key` never leaves the VM and is not in any backup outside it; if it is lost or the VM is compromised, create a new CA and re-enroll every device. `kart-device-ca.pem` is public: it goes to the admins for the border Nginx. Later, `sudo kart-enroll ca` prints it again.

### Upgrading a VM set up before ADR-0004

The first release with the enroll service changes the broker's users and ports, so prepare the VM before it deploys:

1. `systemctl stop kart-analytics-update.timer`
2. In `/etc/kart-analytics/.env`: add `MQTT_DYNSEC_ADMIN_PASSWORD` and `PIT_WALL_MQTT_PASSWORD` (`openssl rand -hex 24`), remove `INGEST_MQTT_USER` (the user is now always `ingest`). Put `PIT_WALL_MQTT_PASSWORD` into `pit-wall.config.json` as `mqttPassword`.
3. Create the device CA (6.1).
4. Pin and deploy: `PIN_VERSION=<VERSION>` in `update.conf`, `systemctl start kart-analytics-update.service`, check `journalctl -u kart-analytics-update`. Then run that release's `install.sh` (installs `kart-enroll`), remove the pin and start the timer again.
5. `mosquitto.passwd` is no longer used; delete it. Port 1883 is no longer published: devices still on an old agent stop sending until they are updated and enrolled.

### 6.2 Border Nginx (lab admins)

Send the admins [`border-nginx.example.conf`](border-nginx.example.conf) with the placeholders filled in, plus `kart-device-ca.pem`. `ssl_certificate` must be the full chain (certificate plus intermediate, e.g. acme.sh's `fullchain.cer`): karts and devices don't fetch a missing intermediate the way browsers do and fail with `UnknownIssuer`. Then add the border Nginx rules to the Proxmox firewall (section 1.2).

The same host serves the pit wall at `https://<DEVICE_HOST>/` to the lab network and VPN. Its live view can't use `/mqtt` (that is the device listener), so set the path in `/etc/kart-analytics/pit-wall.config.json`:

```json
"mqttUrl": "wss://<DEVICE_HOST>/pit-wall/mqtt"
```

The pit wall reads the file on every page load, so no restart is needed. It also applies to `http://<VM_IP>:8080`, which keeps working from the lab network and VPN.

Check from a machine on the lab network:

```bash
curl -s https://<DEVICE_HOST>/enroll/v1/health                     # ok
curl -s -o /dev/null -w '%{http_code}\n' https://<DEVICE_HOST>/mqtt  # 403 without a device certificate
curl -s -o /dev/null -w '%{http_code}\n' https://<DEVICE_HOST>/      # 200: the pit wall
```

### 6.3 Enroll a device

1. **Kart:** headunit → *Telemetry* → *Configure* (admin mode): broker `wss://<DEVICE_HOST>/mqtt`, save. Then *Enroll* on the Telemetry page. The kart must be on the lab network (phase 1). It shows a code like `K7QM-2XTR`.
   **Speedcamera:** web UI → lap timer → kart link: server `<DEVICE_HOST>`, device ID, *Enroll*.
2. **Admin, on the VM:**

   ```bash
   sudo kart-enroll requests                 # pending requests with their codes
   sudo kart-enroll approve K7QM-2XTR        # or: --as kart-03 to assign another ID
   ```

   Compare the code with the device's screen before approving. A device that is already enrolled (new SD card, re-installed Pi) needs `--replace`; its old login stops working.
3. The device collects its certificate and login within a few seconds and connects. Requests expire after 10 minutes.

| Task | How |
|---|---|
| Enrolled devices | `sudo kart-enroll devices` |
| Block a device (stolen, lost) | `sudo kart-enroll disable <ID>`; takes effect at once, also for a connected device |
| Unblock | `sudo kart-enroll enable <ID>` |
| Who was issued what | `docker run --rm -v kart-analytics_enroll-data:/d debian:trixie-slim cat /d/issued.jsonl` |
| Enroll service log | `docker compose -p kart-analytics logs -f enroll` (from the release's `deploy/compose`) |

Certificates are valid for one year; the Telemetry page shows the expiry. Renewal is not automated yet: re-enroll with `--replace` before it expires.

**Before the vhost exists** (testing in the lab): allow the lab network to 9002 and 8082 in the Proxmox firewall for the duration of the test, and set the kart's broker to `ws://<VM_IP>:9002` and `enroll.url` to `http://<VM_IP>:8082` (in `/etc/kart-agent/agent.toml`; the passwords then cross the lab network unencrypted). Remove both again afterwards.

## 7. Grafana sign-in with the lab SSO

Grafana signs users in with the lab's Keycloak over OIDC (*Sign in with Lab SSO*). Keycloak only says who someone is (ADR-0003): every new user starts as **Viewer**, and an admin changes roles in Grafana (*Administration → Users*). Grafana keeps those roles across logins. The local admin from `.env` stays as a break-glass login in case Keycloak is down.

### 7.1 Keycloak client (lab admins)

Ask the lab admins for an OIDC client in the lab realm (the realm's discovery URL is in the lab wiki). `<GRAFANA_URL>` is the address users open, e.g. `http://<VM_IP>:3000`:

| Setting | Value |
|---|---|
| Client type / ID | OpenID Connect, e.g. `kart-grafana` |
| Client authentication | on (confidential client, gives a secret) |
| Authentication flow | *Standard flow* only |
| Root URL | `<GRAFANA_URL>` |
| Valid redirect URIs | `<GRAFANA_URL>/login/generic_oauth` |
| Valid post logout redirect URIs | `<GRAFANA_URL>/login` |
| PKCE method (Advanced) | `S256` |

The default client scopes (`profile`, `email`) are enough; group claims are not needed. Accounts need an e-mail address in LDAP, since Grafana links users by it.

### 7.2 Configure Grafana

In `/etc/kart-analytics/.env`, set `GRAFANA_ROOT_URL` (= `<GRAFANA_URL>`, no trailing slash), `OIDC_ISSUER` (the realm URL, i.e. the discovery URL without `/.well-known/openid-configuration`), `GRAFANA_OIDC_CLIENT_ID` and `GRAFANA_OIDC_CLIENT_SECRET`, then deploy (`systemctl start kart-analytics-update.service`). All four are required: without them a release with SSO fails to start and the updater rolls back to the previous release. When updating a VM set up earlier, add them before that release arrives.

The Grafana container fetches tokens from Keycloak itself, so the VM needs outbound HTTPS to the SSO host. Check:

```bash
cd /opt/kart-analytics/current/deploy/compose
docker compose -p kart-analytics exec grafana wget -qO- "$(sudo sed -n 's/^OIDC_ISSUER=//p' /etc/kart-analytics/.env)/.well-known/openid-configuration" | head -c 200
```

Then open `<GRAFANA_URL>`, choose *Sign in with Lab SSO*, and promote the first engineers to Editor or Admin as the local admin. `GRAFANA_ROOT_URL` must be exactly the address in the browser; otherwise Keycloak rejects the redirect (`Invalid parameter: redirect_uri`). When Grafana moves behind the border Nginx, change it there and in the Keycloak client.

While Grafana is reached over plain HTTP, the session cookie crosses the lab network unencrypted. That's acceptable on the lab network and VPN; the move behind the border Nginx brings HTTPS.

---

## Operations

| Task | How |
|---|---|
| Release | `git tag analytics-vX.Y.Z && git push origin analytics-vX.Y.Z`; deployed within ~5 min after CI is done |
| Status / logs of deploys | `systemctl list-timers kart-analytics-update.timer`, `journalctl -u kart-analytics-update` |
| Logs of the stack | `cd /opt/kart-analytics/current/deploy/compose && docker compose -p kart-analytics logs -f ingest` |
| Deploy now | `systemctl start kart-analytics-update.service` |
| Pin / roll back / try a pre-release | set `PIN_VERSION=X.Y.Z` in `update.conf`, then deploy now; remove it to follow the newest release again |
| Retry a failed version | `kart-analytics-update --force` (a failed version is otherwise skipped until a newer one appears) |
| Pause deploys | `systemctl stop kart-analytics-update.timer` (`start` to resume) |
| Approve a device | `sudo kart-enroll requests`, then `sudo kart-enroll approve <CODE>` (section 6.3) |

The updater exports `KART_VERSION`. For manual compose commands, set it yourself: `KART_VERSION=$(cat /var/lib/kart-analytics/current-version) docker compose -p kart-analytics --env-file /etc/kart-analytics/.env -f compose.yml -f compose.prod.yml …`.

### Rollbacks and migrations

`ingest` applies `db/migrations` on start. A rollback only swaps images, so it never undoes a migration. Migrations therefore have to stay compatible with the previous release (expand first, remove in a later release). If a migration itself went wrong, restore the dump taken before the deploy.

### Restoring a backup

```bash
systemctl stop kart-analytics-update.timer
cd /opt/kart-analytics/current/deploy/compose
export KART_VERSION=$(cat /var/lib/kart-analytics/current-version)
C="docker compose -p kart-analytics --env-file /etc/kart-analytics/.env -f compose.yml -f compose.prod.yml"
$C stop ingest pit-api grafana
$C exec -T timescaledb sh -c 'dropdb -U "$POSTGRES_USER" telemetry && createdb -U "$POSTGRES_USER" telemetry'
$C exec -T timescaledb sh -c 'psql -U "$POSTGRES_USER" -d telemetry -c "CREATE EXTENSION timescaledb; SELECT timescaledb_pre_restore();"'
$C exec -T timescaledb sh -c 'pg_restore -U "$POSTGRES_USER" -d telemetry --no-owner' < /var/backups/kart-analytics/<DUMP>.dump
$C exec -T timescaledb sh -c 'psql -U "$POSTGRES_USER" -d telemetry -c "SELECT timescaledb_post_restore();"'
$C up -d
systemctl start kart-analytics-update.timer
```

Roles live outside the database, so `grafana_ro` and `pit_api_ro` survive the restore. Whole-VM backups are Proxmox's job (`vzdump`; with the guest agent the filesystem is frozen for the snapshot). That snapshot is still only crash-consistent for a running PostgreSQL, which is why the dumps exist.

## Not done yet

The pit wall outside the lab network and VPN, Keycloak SSO for the pit wall (Grafana has it, section 7), Grafana over HTTPS, the management interface (approving enrollments there, public `/enroll/`), automatic certificate renewal. See the TODOs in `deploy/compose/compose.prod.yml` and `deploy/mosquitto/mosquitto.prod.conf`.
