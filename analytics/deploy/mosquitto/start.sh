#!/bin/sh
# Broker start (compose.prod.yml): on the first start, creates the dynamic security file
# with the admin user the enroll service connects as. Later starts leave it alone; the
# admin password is only read here, so changing it means changing it in the plugin too.
set -eu
file=/mosquitto/data/dynamic-security.json
if [ ! -f "$file" ]; then
    : "${MQTT_DYNSEC_ADMIN_PASSWORD:?set in .env}"
    mosquitto_ctrl dynsec init "$file" dynsec-admin "$MQTT_DYNSEC_ADMIN_PASSWORD"
    chown mosquitto:mosquitto "$file"
    chmod 600 "$file"
fi
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
