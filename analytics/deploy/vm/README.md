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
| `/etc/kart-analytics/mosquitto.passwd` | broker users (`ingest`, `pit-wall`) |
| `/etc/kart-analytics/pit-wall.config.json` | read-only broker login for browsers (from `deploy/compose/pit-wall.config.example.json`) |
| `/etc/kart-analytics/update.conf` | updater settings (from `update.conf.example`) |
| `/opt/kart-analytics/releases/<version>` | extracted bundles; `/opt/kart-analytics/current` points at the running one |
| `/var/lib/kart-analytics/current-version` | the deployed version (`failed-version`: last failed deploy) |
| `/var/backups/kart-analytics/` | `pg_dump` taken before every deploy |
| Docker volumes `kart-analytics_*` | database, Grafana and broker data |

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
# later: 1883 for the karts (WireGuard) and the timing device
```

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

# Broker users: ingest (same password as INGEST_MQTT_PASSWORD) and pit-wall (read-only, browsers).
touch mosquitto.passwd
docker run --rm -it -v /etc/kart-analytics:/c eclipse-mosquitto:2.0.22 mosquitto_passwd /c/mosquitto.passwd ingest
docker run --rm -it -v /etc/kart-analytics:/c eclipse-mosquitto:2.0.22 mosquitto_passwd /c/mosquitto.passwd pit-wall
# The broker runs as uid 1883 and must be able to read the file:
chown 1883:1883 mosquitto.passwd && chmod 600 mosquitto.passwd

chmod 600 .env pit-wall.config.json update.conf
```

The database passwords take effect only when the database volume is created on the first start. Changing them later means `ALTER ROLE … PASSWORD` in the database as well.

## 5. First deploy

```bash
systemctl start kart-analytics-update.service
journalctl -u kart-analytics-update -f
docker compose -p kart-analytics ls && docker ps
```

Then open Grafana at `http://<HOSTNAME>:3000` and the pit wall at `http://<HOSTNAME>:8080`.

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

TLS reverse proxy (`wss://` for the pit wall), Keycloak SSO, broker ACLs, mTLS and WireGuard for the karts. See the TODOs in `deploy/compose/compose.prod.yml` and `deploy/mosquitto/mosquitto.prod.conf`.
