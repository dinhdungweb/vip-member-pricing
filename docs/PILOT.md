# Helios pilot and rollback

## Pre-cutover

1. Install the app without activating Functions.
2. Choose a managed pricing plan/development entitlement.
3. Set `goLiveAt`; do not import old points, tiers, or order history.
4. Recreate tier thresholds, discounts, access rules, badge settings, and
   rewards in the app.
5. Enable the theme app embed and product block in a duplicated theme.
6. Compare at least 30 product/variant cases:
   regular, catalog sale, each tier, guest, sold out, collection, search,
   recommendations, multi-currency, and restricted products.
7. Verify checkout totals against the admin preview, including 10% catalog
   sale + 6% tier = 16% from compare-at price.
8. Exercise duplicate paid webhook, partial/full refund, out-of-order events,
   simultaneous orders, double redemption, and reward cancellation.

## Cutover

1. Select a low-traffic window.
2. Disable the legacy member-pricing/Draft Order feature flag.
3. Activate the app Discount and Validation Functions.
4. Publish the duplicated theme with its app embed enabled.
5. Place test orders as guest and every tier.
6. Watch price mismatches, webhook lag, outbox failures, queue depth, and
   checkout validation continuously for 24 hours.
7. Continue pilot for at least seven days before removing legacy theme/backend
   references.

Never enable both pricing mechanisms simultaneously.

## Rollback

1. Deactivate the app program, which disables Discount and Validation
   Functions.
2. Disable the theme app embed.
3. Re-enable the legacy theme feature flag.
4. Keep webhook data and outbox state for investigation; do not delete or
   rewrite member ledgers.
5. Record the incident and affected config versions in the audit trail.
