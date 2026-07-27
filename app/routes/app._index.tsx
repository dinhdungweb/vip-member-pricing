import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { syncManagedPricingSubscription } from "../modules/billing/subscription.server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../modules/shops/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const subscription = await syncManagedPricingSubscription(shop.id, admin);

  return {
    shop: shop.domain,
    status: shop.status,
    enabled: shop.programConfig?.enabled ?? false,
    tiers: shop.tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      rank: tier.rank,
      minSpendMinor: tier.minSpendMinor.toString(),
      discountBps: tier.discountBps,
    })),
    plan: subscription?.planHandle ?? "No active plan",
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="VIP Member Pricing">
      <s-section heading="Program status">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Store: <s-text>{data.shop}</s-text>
          </s-paragraph>
          <s-paragraph>
            Status:{" "}
            <s-text>{data.enabled ? "Active" : "Test mode / inactive"}</s-text>
          </s-paragraph>
          <s-paragraph>
            Plan: <s-text>{data.plan}</s-text>
          </s-paragraph>
          <s-button href="/app/program" variant="primary">
            Configure program
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Tier overview">
        {data.tiers.length === 0 ? (
          <s-paragraph>No tiers configured.</s-paragraph>
        ) : (
          <s-unordered-list>
            {data.tiers.map((tier) => (
              <s-list-item key={tier.id}>
                {tier.name}: threshold {tier.minSpendMinor}, discount{" "}
                {(tier.discountBps / 100).toFixed(2)}%
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>

      <s-section slot="aside" heading="MVP guardrails">
        <s-unordered-list>
          <s-list-item>Catalog sale must use compare-at price.</s-list-item>
          <s-list-item>Product discounts do not combine.</s-list-item>
          <s-list-item>Shipping discounts may combine.</s-list-item>
          <s-list-item>Maximum 10 membership tiers.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
