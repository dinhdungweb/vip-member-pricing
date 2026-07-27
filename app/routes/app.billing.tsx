import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  PLAN_LIMITS,
  syncManagedPricingSubscription,
} from "../modules/billing/subscription.server";
import { ensureShop } from "../modules/shops/shop.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const subscription = await syncManagedPricingSubscription(shop.id, admin);
  return {
    plan: subscription?.planHandle ?? null,
    status: subscription?.status ?? "NO_PLAN",
    usage: subscription?.loyaltyOrdersThisPeriod ?? 0,
    limit: subscription
      ? (PLAN_LIMITS[subscription.planHandle] ?? 0)
      : 0,
    pricingUrl: `shopify://admin/charges/vip-member-pricing/pricing_plans`,
  };
};

export default function BillingRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Plan and usage">
      <s-section heading="Managed Shopify pricing">
        <s-stack direction="block" gap="base">
          <s-text>Plan: {data.plan ?? "No active plan"}</s-text>
          <s-text>Status: {data.status}</s-text>
          <s-text>
            Loyalty orders: {data.usage} /{" "}
            {Number.isSafeInteger(data.limit) ? data.limit : "Unlimited"}
          </s-text>
          <s-button href={data.pricingUrl} variant="primary">
            View pricing plans
          </s-button>
        </s-stack>
      </s-section>
      <s-banner tone="info">
        Crossing the monthly order limit does not disable active discounts.
        Configuration is locked only after two consecutive over-limit cycles.
      </s-banner>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
