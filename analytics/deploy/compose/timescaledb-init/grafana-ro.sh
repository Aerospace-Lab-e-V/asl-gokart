#!/bin/sh
# Read-only role for Grafana. Tables created later by ingest's migrations
# (owned by $POSTGRES_USER) are readable through the default privileges.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE grafana_ro LOGIN PASSWORD '${GRAFANA_DB_PASSWORD}';
	GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO grafana_ro;
	GRANT USAGE ON SCHEMA public TO grafana_ro;
	ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public GRANT SELECT ON TABLES TO grafana_ro;
EOSQL
