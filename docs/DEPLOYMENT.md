# Production deployment

## 1. Shopify resources

1. Create separate staging and production apps in the Partner Dashboard.
2. Configure managed pricing plans: Starter $14.99, Growth $39.99, and Pro
   $99.00, each with a 14-day trial and development-store exemption.
3. Link `shopify.app.staging.toml` and `shopify.app.toml` to their respective
   apps with Shopify CLI.
4. Confirm scopes and protected-customer-data declarations.
5. Set the production application URL and allowed redirection URLs.
6. Generate Function schemas/builds after linking, then deploy extensions.

## 2. PostgreSQL

Do not modify an existing PostgreSQL data directory. Take and verify a backup
before provisioning.

Create:

- `vip_pricing_migrate`: owns schema/migrations; direct PostgreSQL connection.
- `vip_pricing`: runtime CRUD only; `NOBYPASSRLS`; PgBouncer transaction pool.
- `vip_pricing_worker`: narrowly granted outbox dispatcher role with
  `BYPASSRLS`; it is available only to worker containers, never web traffic.
- Separate databases/credentials for staging and production.

Run migrations through `DIRECT_URL`, then verify:

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname IN ('vip_pricing', 'vip_pricing_migrate');
```

Run the RLS integration suite using the runtime connection:

```powershell
$env:TEST_DATABASE_URL="postgresql://vip_pricing:...@host:5432/vip_pricing"
npm test
```

## 3. Required secrets

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `DATABASE_URL` through PgBouncer
- `DIRECT_URL` to PostgreSQL
- `REDIS_URL`
- `REWARD_ENCRYPTION_KEY`
- `REWARD_CODE_SECRET`

Use a secret store. Rotate reward secrets only with a migration/re-encryption
procedure because existing issued codes use the encryption key.

## 4. Release sequence

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run db:deploy
npm run deploy
```

Deploy the web image and worker image from the same commit. Start workers only
after migrations complete. Validate `/healthz`, queue connectivity, app proxy,
one paid webhook, one customer metafield sync, and a test checkout.

For the included Compose topology:

```powershell
Copy-Item .env.production.example .env.production
docker compose --env-file .env.production up -d --build --scale web=2 --scale worker=2
```

Place `fullchain.pem` and `privkey.pem` in `ops/certs` before starting Nginx.

## 5. Backup and monitoring

- Continuous WAL archive to S3-compatible off-site storage; RPO target 5 min.
- Daily full backup; retain 7 daily, 4 weekly, and 6 monthly copies.
- Monthly restore drill into an isolated database.
- Alerts: HTTP error rate, p95 latency, webhook acknowledgement, webhook lag,
  outbox/queue lag, worker failures, database connections, disk, Redis memory,
  certificate expiry, and backup age.
- Purge webhook payloads after 30 days and audit logs after 12 months.

The repository contains topology examples, not production credentials or TLS
material. Replace `app.example.com` and mount real certificates before starting
Nginx.
