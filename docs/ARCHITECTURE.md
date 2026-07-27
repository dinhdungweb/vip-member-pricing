# Architecture and contracts

## Runtime topology

```text
Shopify Admin / Storefront / Customer Accounts
                    |
                  Nginx
                    |
        React Router web instances × 2
          |                    |
       PgBouncer             Redis
          |                    |
      PostgreSQL        BullMQ workers × 2
                                |
                         Shopify Admin API
```

The web process acknowledges valid webhooks after durable insert and queueing.
Workers process facts inside tenant transactions and create outbox rows. The
outbox publishes customer state, resolved access configuration, and rewards to
Shopify.

## Tenant boundary

All business tables contain `shopId`. Runtime queries use `withTenant(shopId)`,
which starts a transaction and calls:

```sql
SELECT set_config('app.current_shop_id', '<shop uuid>', true);
```

RLS is forced on tenant tables. Member-tier, ledger-member,
reward-tier, and redemption-member/reward relationships also use composite
`(shopId, id)` foreign keys. The runtime role must not own tables and must not
have `BYPASSRLS`.

`Shop`, `Session`, and webhook intake are control-plane tables without tenant
RLS. They contain no customer profile fields. Workers enumerate shop IDs from
the narrowly scoped dispatcher connection; job execution then returns to the
runtime connection and opens a tenant transaction.

## Pricing

- Money is stored as `BIGINT` minor units.
- Percentages are integer basis points.
- Catalog sale is represented only by Shopify price/compare-at price.
- Tier discount is calculated from compare-at/original price and subtracted
  from current price.
- Result is capped at zero/current line value.
- Product discounts do not combine; shipping and permitted order discounts do.
- Product badge excludes cart/order-level discounts.

## State publication

Customer metafield:

```text
$app:vip_pricing/member_state
```

Discount metafield:

```text
$app:vip_pricing/discount_config
```

Validation metafield:

```text
$app:vip_pricing/access_config
```

Each JSON payload carries `schemaVersion`, `configVersion`, and `enabled`.
Product/collection/tag access rules are resolved to product GIDs in the worker
before the immutable `FunctionConfigVersion` is marked published.

## Webhook idempotency

- Shopify webhook ID is globally unique in `WebhookEvent`.
- `(shopId, orderGid)` prevents duplicate order facts.
- `(shopId, idempotencyKey)` prevents duplicate ledger/redemption entries.
- Member rows are locked for spend, point, and redemption changes.
- Refund events create a negative ledger and never automatically downgrade
  tier.
- Outbox jobs retry exponentially and enter `FAILED` after the configured
  maximum. Failed reward issuance compensates reserved points.

## Fail-open and enforcement

The storefront extension fails open for display: if app proxy is unavailable,
native prices remain untouched. Product access is never trusted to storefront
JavaScript; the Cart/Checkout Validation Function is authoritative for cart,
accelerated checkout, and Storefront API carts.
