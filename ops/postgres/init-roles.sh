#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 \
  --set=runtime_password="$VIP_RUNTIME_DB_PASSWORD" \
  --set=worker_password="$VIP_WORKER_DB_PASSWORD" \
  --set=migration_password="$VIP_MIGRATION_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE vip_pricing LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE vip_pricing_worker LOGIN PASSWORD :'worker_password' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE vip_pricing_migrate LOGIN PASSWORD :'migration_password' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT CONNECT ON DATABASE vip_pricing TO vip_pricing, vip_pricing_worker, vip_pricing_migrate;
GRANT CREATE ON SCHEMA public TO vip_pricing_migrate;
ALTER DEFAULT PRIVILEGES FOR ROLE vip_pricing_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vip_pricing;
ALTER DEFAULT PRIVILEGES FOR ROLE vip_pricing_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vip_pricing;
ALTER DEFAULT PRIVILEGES FOR ROLE vip_pricing_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vip_pricing_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE vip_pricing_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vip_pricing_worker;
SQL
