# Production host: LXC container on Proxmox VE

The analytics stack runs with Docker Compose inside an unprivileged LXC container on a Proxmox VE node. Deploys are **pull-based**: CI publishes images to GHCR, and a systemd timer in the container fetches and starts new releases.

```
git tag analytics-vX.Y.Z ─► CI (ci-analytics-release.yml): checks → kart-ingest, kart-pit-api, kart-pit-wall → kart-analytics-deploy
                                                                         ghcr.io/aerospace-lab-e-v/<image>:X.Y.Z
container: kart-analytics-update.timer (every 5 min)
   newest stable X.Y.Z of kart-analytics-deploy (or PIN_VERSION)
   → extract the bundle to /opt/kart-analytics/releases/X.Y.Z
   → pg_dump → docker compose pull → up --wait
   → healthy: record version, prune old releases │ not healthy: start the previous release again
```

The deploy bundle (`deploy/bundle.Dockerfile`) carries the compose files, broker config, Grafana provisioning and this directory. It never contains secrets.


| Path in the container | What |
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

## 1. Create the container (Proxmox host)

Check first:
- **Storage** for the root disk must support Docker's overlay2 driver inside the container: ext4 / LVM-thin are fine, ZFS needs OpenZFS ≥ 2.2 (Proxmox VE ≥ 8.1). Check with `pveversion -v | grep zfs`.
- **Outbound HTTPS** from the container's network to `ghcr.io` and `pkg-containers.githubusercontent.com` (image pulls), and to the Debian and Docker apt mirrors.

```bash
pveam update
pveam download <TEMPLATE_STORAGE> debian-13-standard_<VERSION>_amd64.tar.zst

pct create <CTID> <TEMPLATE_STORAGE>:vztmpl/debian-13-standard_<VERSION>_amd64.tar.zst \
  --hostname <HOSTNAME> \
  --unprivileged 1 \
  --features nesting=1,keyctl=1 \
  --cores 2 --memory 4096 --swap 1024 \
  --rootfs <STORAGE>:32 \
  --net0 name=eth0,bridge=<BRIDGE>,tag=<VLAN_TAG>,ip=<CT_IP>/<PREFIX>,gw=<GATEWAY> \
  --nameserver <DNS_SERVER> --searchdomain <SEARCH_DOMAIN> \
  --onboot 1 \
  --ssh-public-keys <ADMIN_KEYS_FILE>
pct start <CTID>
```

- `nesting=1,keyctl=1` are what Docker needs in an unprivileged container. Don't make it privileged.
- The network is configured by Proxmox through `net0`. There is no `/etc/network/interfaces` to edit inside the container.
- 32 GB is a starting point for TimescaleDB plus images. Grow it with `pct resize <CTID> rootfs +<N>G`.
- Lab admins: add a DNS record for the container, firewall rules so team clients reach ports **3000** (Grafana) and **8080** (pit wall), and later **1883** for karts and the timing device. Also include the container in the scheduled `vzdump` backups.

## 2. Prepare the container

```bash
pct enter <CTID>

apt update && apt full-upgrade -y
apt install -y ca-certificates curl jq

# Docker CE from Docker's repository (https://docs.docker.com/engine/install/debian/)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

docker info | grep -E 'Storage Driver|Cgroup'   # expect overlay2 and cgroup v2
docker run --rm hello-world
```

Then enable unattended security updates (`apt install unattended-upgrades`).

## 3. Install the updater

Take the updater from the release you want to run first:

```bash
V=0.1.0
docker create --name bundle ghcr.io/aerospace-lab-e-v/kart-analytics-deploy:$V /bundle
docker cp bundle:/bundle /root/bundle-$V && docker rm bundle
/root/bundle-$V/deploy/lxc/install.sh     # script, units, /etc/kart-analytics/update.conf; enables the timer
```

If the GHCR packages are private, first `docker login ghcr.io` with a token that has `read:packages`, and set `REGISTRY_AUTH=<user>:<token>` in `update.conf`. Making the packages public is simpler, since the repo is public anyway: on GitHub, open each package → *Package settings* → *Change visibility*.

When a release changes the updater or its units, run `install.sh` from that release's directory again: `/opt/kart-analytics/current/deploy/lxc/install.sh`.

## 4. Secrets

All of these are root-only (`chmod 600`) and never leave the container.

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

Roles live outside the database, so `grafana_ro` and `pit_api_ro` survive the restore. Whole-container backups are Proxmox's job (`vzdump`). A snapshot of a running PostgreSQL is only crash-consistent, which is why the dumps exist.

## Not done yet

TLS reverse proxy (`wss://` for the pit wall), Keycloak SSO, broker ACLs, mTLS and WireGuard for the karts. See the TODOs in `deploy/compose/compose.prod.yml` and `deploy/mosquitto/mosquitto.prod.conf`.
