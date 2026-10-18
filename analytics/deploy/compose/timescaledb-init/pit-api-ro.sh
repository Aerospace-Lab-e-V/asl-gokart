#!/bin/sh
# Read-only role for pit-api (pit wall history). Same pattern as grafana-ro.sh:
# tables created later by ingest's migrations are readable through default privileges.
# Runs once, on an empty volume; on an existing one, run these statements by hand.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE pit_api_ro LOGIN PASSWORD '${PIT_API_DB_PASSWORD}';
	GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO pit_api_ro;
	GRANT USAGE ON SCHEMA public TO pit_api_ro;
	ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public GRANT SELECT ON TABLES TO pit_api_ro;
EOSQL
