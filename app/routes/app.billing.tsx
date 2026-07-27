import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  PLAN_LIMITS,
  syncManagedPricingSubscription,
} from "../modules/billing/subscription.server";
import { ensureShop } from "../modules/shops/shop.server";
import { authenticate } from "../shopify.server";
import {
  Alert,
  Card,
  Metric,
  PageHeader,
  SectionHeader,
  StatusBadge,
} from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const subscription = await syncManagedPricingSubscription(shop.id, admin);
  return {
    plan: subscription?.planHandle ?? null,
    status: subscription?.status ?? "NO_PLAN",
    usage: subscription?.loyaltyOrdersThisPeriod ?? 0,
    limit: subscription ? (PLAN_LIMITS[subscription.planHandle] ?? 0) : 0,
    pricingUrl: `shopify://admin/charges/vip-member-pricing/pricing_plans`,
  };
};

export default function BillingRoute() {
  const data = useLoaderData<typeof loader>();
  const hasPlan = Boolean(data.plan);
  const unlimited = !Number.isSafeInteger(data.limit);
  const usagePercent =
    !hasPlan || unlimited || data.limit === 0
      ? 0
      : Math.min(100, Math.round((data.usage / data.limit) * 100));

  return (
    <main className="app-page">
      <PageHeader
        eyebrow="Managed by Shopify"
        title="Plan & usage"
        description="Track member-order usage for the current cycle and manage your plan through Shopify."
        actions={
          <a className="button button--primary" href={data.pricingUrl}>
            View plans
          </a>
        }
      />

      <section
        className="metrics-grid metrics-grid--three"
        aria-label="Plan information"
      >
        <Metric label="Current plan" value={data.plan ?? "No active plan"} />
        <Metric label="Status" value={data.status} />
        <Metric
          label="Orders this cycle"
          value={`${data.usage.toLocaleString("en-US")} / ${
            unlimited ? "Unlimited" : data.limit.toLocaleString("en-US")
          }`}
        />
      </section>

      <div className="content-grid">
        <div className="content-main">
          <Card>
            <SectionHeader
              title="Current-cycle usage"
              description={
                unlimited
                  ? "The current plan has no member-order limit."
                  : `${usagePercent}% of the allowance has been used.`
              }
              action={
                <StatusBadge
                  tone={
                    !hasPlan
                      ? "warning"
                      : usagePercent >= 90
                        ? "danger"
                        : "success"
                  }
                >
                  {!hasPlan
                    ? "Plan required"
                    : usagePercent >= 90
                      ? "Near the limit"
                      : "Within allowance"}
                </StatusBadge>
              }
            />
            <div className="progress" aria-label={`${usagePercent}% used`}>
              <div
                className="progress__bar"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <div className="usage-scale">
              <span>{data.usage.toLocaleString("en-US")} orders used</span>
              <span>
                {unlimited
                  ? "Unlimited"
                  : `${data.limit.toLocaleString("en-US")} orders`}
              </span>
            </div>
          </Card>
          <Alert tone="info">
            Exceeding the monthly limit does not disable active discounts.
            Configuration is locked only after two consecutive over-limit
            cycles.
          </Alert>
        </div>

        <aside className="content-aside">
          <Card className={!hasPlan ? "card--accent" : ""}>
            <SectionHeader
              title={hasPlan ? "Manage plan" : "Start with a plan"}
              description={
                hasPlan
                  ? "Change plans or review billing details in Shopify Admin."
                  : "An active plan is required before you can edit and publish configuration."
              }
            />
            <a
              className="button button--primary button--full"
              href={data.pricingUrl}
            >
              {hasPlan ? "Manage in Shopify" : "Choose a plan"}
            </a>
          </Card>
        </aside>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
