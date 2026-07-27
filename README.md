# VIP Member Pricing

Shopify Public App for tier-based member pricing, catalog-sale stacking,
member-only product access, points, and basic rewards.

The app is intentionally independent from the Helios theme. Helios is only the
first pilot store.

## Implemented

- React Router 7 embedded admin app with Shopify OAuth/session storage.
- PostgreSQL/Prisma 7 data model with tenant RLS and composite tenant foreign
  keys.
- Idempotent paid-order, refund, cancellation, uninstall, and compliance
  webhook ingestion through Redis/BullMQ.
- Automatic tier upgrades, immutable points ledger, and customer metafield
  synchronization.
- Rust Discount Function implementing direct catalog-sale + tier stacking.
- Rust Cart/Checkout Validation Function for login and minimum-tier rules.
- Theme App Extension with guest/member badges, out-of-stock stacking,
  member-price preview, batch app-proxy context, and dynamic-section support.
- Customer Account extension and signed legacy account app-proxy page.
- Atomic reward reservation, encrypted deterministic discount codes, retries,
  cancellation, and compensating ledger entries.
- Shopify managed-pricing entitlement synchronization.
- Docker, PgBouncer, Redis, two web processes, two workers, Nginx, CI, and
  deployment runbooks.

## Pricing contract

For original/compare-at price `C`, current catalog price `P`, and member tier
rate `T`:

```text
tier discount = C × T
final price    = max(0, P - tier discount)
badge rate     = (C - final price) / C
```

Thus a 10% catalog sale and 6% tier discount produce a 16% badge and a final
price of 84% of the original price. This contract does not claim additive
stacking with a separate automatic product discount.

## Requirements

- Node.js `22.12+`
- Shopify CLI and a Shopify Partner organization
- Rust stable with `wasm32-unknown-unknown` for local Function builds
- PostgreSQL 17 patched or 18.4
- Redis

## First-time setup

```powershell
Copy-Item .env.example .env
npm ci
npm run config:link
npm run db:generate
npm run db:deploy
npm run dev
```

Before `config:link`, create separate staging and production apps in the
Shopify Partner Dashboard. Never reuse the Helios theme repository or embed a
store domain/token in source.

`SHOPIFY_APP_URL` must contain the real HTTPS application origin. `npm run
deploy` writes that origin into the Customer Account extension before invoking
Shopify CLI.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

RLS integration tests run when `TEST_DATABASE_URL` points to the non-owner
runtime role. Shopify Functions require the app to be linked before Shopify CLI
can generate its local schema and run Function builds.

## Operations

- [Architecture and contracts](docs/ARCHITECTURE.md)
- [Production deployment](docs/DEPLOYMENT.md)
- [Helios pilot and rollback](docs/PILOT.md)
- [Security and release gates](docs/security.md)

The checked-in Docker Compose file is a local/staging topology reference. For
production, provision secrets, TLS certificates, off-site backups, WAL
archiving, monitoring, and database roles outside the repository.
