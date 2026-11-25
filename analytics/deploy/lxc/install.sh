#!/usr/bin/env bash
# Installs (or updates) the updater and its systemd units from an extracted deploy bundle.
#   sudo ./install.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

install -m 755 "$here/kart-analytics-update" /usr/local/sbin/kart-analytics-update
install -m 644 "$here/kart-analytics-update.service" "$here/kart-analytics-update.timer" /etc/systemd/system/
install -d -m 700 /etc/kart-analytics
[[ -e /etc/kart-analytics/update.conf ]] || install -m 600 "$here/update.conf.example" /etc/kart-analytics/update.conf

systemctl daemon-reload
systemctl enable --now kart-analytics-update.timer
echo "installed; first run: systemctl start kart-analytics-update.service"
