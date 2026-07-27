import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { syncManagedPricingSubscription } from "../modules/billing/subscription.server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../modules/shops/shop.server";
import {
  Card,
  EmptyState,
  FlowSteps,
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
  const hasPlan = data.plan !== "No active plan";
  const hasTiers = data.tiers.length > 0;
  const highestDiscount = data.tiers.reduce(
    (highest, tier) => Math.max(highest, tier.discountBps),
    0,
  );

  return (
    <main className="app-page">
      <PageHeader
        eyebrow={data.shop}
        title="VIP program overview"
        description="Track program health and complete each setup step before applying member benefits."
        actions={
          <a className="button button-primary" href="/app/program">
            Configure program
          </a>
        }
      />

      <section className="metric-grid" aria-label="Overview metrics">
        <Metric
          label="Status"
          value={data.enabled ? "Active" : "Not active"}
          help={
            data.enabled
              ? "Member benefits are live"
              : "The storefront is not affected"
          }
        />
        <Metric
          label="Current plan"
          value={data.plan}
          help="Managed through Shopify Billing"
        />
        <Metric
          label="Membership tiers"
          value={String(data.tiers.length)}
          help="Up to 10 tiers"
        />
        <Metric
          label="Highest benefit"
          value={`${(highestDiscount / 100).toFixed(2)}%`}
          help="Tier-based discount"
        />
      </section>

      <div className="content-grid">
        <div className="content-main">
          <Card>
            <SectionHeader
              title="Setup flow"
              description="Follow these steps in order to avoid incomplete or conflicting configuration."
              action={
                <StatusBadge tone={data.enabled ? "success" : "warning"}>
                  {data.enabled ? "Complete" : "In progress"}
                </StatusBadge>
              }
            />
            <FlowSteps
              steps={[
                {
                  label: "Choose a plan",
                  description: hasPlan
                    ? `${data.plan} is active.`
                    : "An active plan is required to save configuration.",
                  state: hasPlan ? "done" : "current",
                  href: "/app/billing",
                },
                {
                  label: "Create tiers and earning rules",
                  description: hasTiers
                    ? `${data.tiers.length} membership tiers configured.`
                    : "Set the spend threshold and discount for each tier.",
                  state: hasTiers ? "done" : hasPlan ? "current" : "next",
                  href: "/app/program",
                },
                {
                  label: "Configure access and rewards",
                  description:
                    "Choose restricted products, tier requirements, and point rewards.",
                  state: hasTiers ? "current" : "next",
                  href: "/app/access",
                },
                {
                  label: "Review and activate",
                  description: data.enabled
                    ? "The program has been published to Shopify."
                    : "Choose a start time, then activate the program.",
                  state: data.enabled ? "done" : "next",
                  href: "/app/program",
                },
              ]}
            />
          </Card>

          <Card>
            <SectionHeader
              title="Membership tiers"
              description="Review the configured spend thresholds and benefits."
              action={
                <a
                  className="button button-secondary button-small"
                  href="/app/program"
                >
                  Manage tiers
                </a>
              }
            />
            {data.tiers.length === 0 ? (
              <EmptyState
                title="No membership tiers yet"
                description="Create the first tier to start segmenting customers and applying VIP pricing."
                action={
                  <a className="button button-primary" href="/app/program">
                    Create tier
                  </a>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tier</th>
                      <th>Rank</th>
                      <th>Spend threshold</th>
                      <th>Discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tiers.map((tier) => (
                      <tr key={tier.id}>
                        <td>
                          <strong>{tier.name}</strong>
                        </td>
                        <td>#{tier.rank}</td>
                        <td>
                          {Number(tier.minSpendMinor).toLocaleString("en-US")}
                        </td>
                        <td>{(tier.discountBps / 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className="content-aside">
          <Card>
            <SectionHeader title="Operational status" />
            <div className="detail-list">
              <div>
                <span>Store</span>
                <strong>{data.shop}</strong>
              </div>
              <div>
                <span>Program</span>
                <StatusBadge tone={data.enabled ? "success" : "neutral"}>
                  {data.enabled ? "Active" : "Paused"}
                </StatusBadge>
              </div>
              <div>
                <span>Shopify</span>
                <StatusBadge tone="success">Connected</StatusBadge>
              </div>
            </div>
          </Card>
          <Card>
            <SectionHeader
              title="Pricing guardrails"
              description="These limits keep member pricing predictable."
            />
            <ul className="help-list">
              <li>Sale products require a compare-at price.</li>
              <li>Product discounts do not combine with other offers.</li>
              <li>Shipping discounts may be combined.</li>
              <li>Each store supports up to 10 membership tiers.</li>
            </ul>
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
