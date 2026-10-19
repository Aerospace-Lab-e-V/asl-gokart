#!/usr/bin/env bash
# Installs a headunit .deb on THIS machine and checks the kart-agent service lifecycle:
# start, crash restart, watchdog, upgrade, remove, purge.
#
# CI only: it installs and removes a system package and starts a system service, so it
# runs on disposable GitHub runners (which have a real systemd), never on a dev machine.
# No containers: systemd inside Docker needs host-level access that can take over the
# host's TTY and desktop session.
#
#   CI=true packaging/test/deb-systemd-test.sh out/make/deb/x64/headunit_*_amd64.deb
set -euo pipefail

if [ "${CI:-}" != true ]; then
    echo "refusing to run outside CI: this installs a system package and service" >&2
    exit 2
fi
deb="$(realpath "${1:?usage: deb-systemd-test.sh <headunit.deb>}")"

fail() { echo "FAIL: $*" >&2; sudo journalctl -u kart-agent --no-pager -n 40 >&2 || true; exit 1; }
pass() { echo "ok: $*"; }
status() { curl -sf 127.0.0.1:7411/v1/status; }
field() { status | grep -o "\"$1\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '"'; }
main_pid() { systemctl show -p MainPID --value kart-agent; }
healthy() { curl -sf -o /dev/null 127.0.0.1:7411/v1/health; }
new_pid() { local p; p=$(main_pid); [ "$p" != 0 ] && [ "$p" != "$1" ]; }
wait_for() { # <seconds> <description> <command...>
    local secs=$1 what=$2; shift 2
    for _ in $(seq $((secs * 4))); do "$@" >/dev/null 2>&1 && return 0; sleep 0.25; done
    fail "$what"
}
install_deb() {
    # The desktop dependencies of the app do not matter for the agent.
    sudo dpkg --force-depends -i "$deb" >/dev/null 2>&1 || true
}

install_deb
wait_for 15 "agent not active after install" systemctl is-active -q kart-agent
wait_for 15 "API not healthy after install" healthy
systemctl is-enabled -q kart-agent || fail "unit not enabled"
session=$(field id)
pass "installed, enabled and running (session $session)"

pid=$(main_pid)
sudo kill -KILL "$pid"
wait_for 15 "no restart after a crash" new_pid "$pid"
wait_for 15 "API not healthy after a crash" healthy
[ "$(field id)" = "$session" ] || fail "crash restart started a new session"
[ "$(field runs)" = 2 ] || fail "expected run 2 after a crash, got $(field runs)"
pass "crash: restarted in the same session"

pid=$(main_pid)
sudo kill -STOP "$pid"
wait_for 45 "watchdog did not restart a hung agent" new_pid "$pid"
wait_for 15 "API not healthy after the watchdog restart" healthy
[ "$(field id)" = "$session" ] || fail "watchdog restart started a new session"
pass "hang: watchdog restarted it in the same session"

install_deb
wait_for 15 "agent not active after upgrade" systemctl is-active -q kart-agent
wait_for 15 "API not healthy after upgrade" healthy
[ "$(field id)" = "$session" ] || fail "upgrade started a new session"
pass "upgrade: restarted in the same session"

sudo dpkg -r headunit >/dev/null 2>&1 || true
systemctl is-active -q kart-agent && fail "agent still running after remove"
[ -e /etc/systemd/system/kart-agent.service ] && fail "unit link left after remove"
sudo test -d /var/lib/private/kart-agent || fail "logs deleted on remove"
pass "remove: stopped and unlinked, logs kept"

sudo dpkg -P headunit >/dev/null 2>&1 || true
[ -e /etc/kart-agent ] && fail "/etc/kart-agent left after purge"
sudo test -d /var/lib/private/kart-agent || fail "logs deleted on purge"
pass "purge: configuration removed, logs kept"
