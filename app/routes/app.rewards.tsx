import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  subscriptionCanEdit,
  syncManagedPricingSubscription,
} from "../modules/billing/subscription.server";
import { ensureShop } from "../modules/shops/shop.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";
import {
  Alert,
  Card,
  EmptyState,
  Metric,
  PageHeader,
  SectionHeader,
  StatusBadge,
} from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const rewards = await withTenant(shop.id, (transaction) =>
    transaction.reward.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
    }),
  );
  return {
    rewards: rewards.map((reward) => ({
      ...reward,
      pointsCost: reward.pointsCost.toString(),
      fixedAmountMinor: reward.fixedAmountMinor?.toString() ?? null,
      createdAt: reward.createdAt.toISOString(),
      updatedAt: reward.updatedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const subscription = await syncManagedPricingSubscription(shop.id, admin);
  if (!subscriptionCanEdit(subscription)) {
    return { ok: false, error: "An active plan is required to edit rewards." };
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type"));
    const pointsCost = BigInt(String(formData.get("pointsCost") ?? 0));
    const validityDays = Number(formData.get("validityDays") ?? 30);
    const fixedAmountMinor =
      type === "FIXED_DISCOUNT"
        ? BigInt(String(formData.get("fixedAmountMinor") ?? 0))
        : null;
    const freeProductVariantGid =
      type === "FREE_PRODUCT"
        ? String(formData.get("freeProductVariantGid") ?? "").trim()
        : null;
    if (
      !name ||
      !["FIXED_DISCOUNT", "FREE_PRODUCT"].includes(type) ||
      pointsCost <= 0n ||
      !Number.isInteger(validityDays) ||
      validityDays < 1 ||
      validityDays > 365 ||
      (type === "FIXED_DISCOUNT" &&
        (!fixedAmountMinor || fixedAmountMinor <= 0n)) ||
      (type === "FREE_PRODUCT" && !freeProductVariantGid)
    ) {
      return { ok: false, error: "Reward values are invalid." };
    }
    await withTenant(shop.id, (transaction) =>
      transaction.reward.create({
        data: {
          shopId: shop.id,
          name,
          type: type as "FIXED_DISCOUNT" | "FREE_PRODUCT",
          pointsCost,
          validityDays,
          fixedAmountMinor,
          freeProductVariantGid,
        },
      }),
    );
    return { ok: true, message: "Reward created." };
  }

  if (intent === "toggle") {
    const id = String(formData.get("id"));
    const active = String(formData.get("active")) !== "true";
    await withTenant(shop.id, (transaction) =>
      transaction.reward.updateMany({
        where: { id, shopId: shop.id },
        data: { active },
      }),
    );
    return { ok: true, message: "Reward status updated." };
  }
  return { ok: false, error: "Unknown action." };
};

export default function RewardsRoute() {
  const { rewards } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [rewardType, setRewardType] = useState("FIXED_DISCOUNT");
  const activeRewards = rewards.filter((reward) => reward.active).length;

  return (
    <main className="app-page">
      <PageHeader
        eyebrow="Member engagement"
        title="Point rewards"
        description="Build a clear reward catalog so members know how many points they need and what they receive."
      />

      {result?.message && <Alert tone="success">{result.message}</Alert>}
      {result?.error && <Alert tone="danger">{result.error}</Alert>}

      <section
        className="metrics-grid metrics-grid--three"
        aria-label="Reward metrics"
      >
        <Metric label="Total rewards" value={String(rewards.length)} />
        <Metric label="Active" value={String(activeRewards)} />
        <Metric label="Paused" value={String(rewards.length - activeRewards)} />
      </section>

      <div className="content-grid">
        <div className="content-main">
          <Card>
            <SectionHeader
              title="Reward catalog"
              description="Enable or pause a reward without losing its configuration."
            />
            {rewards.length === 0 ? (
              <EmptyState
                title="No rewards yet"
                description="Create the first reward so members can use their earned points."
              />
            ) : (
              <div className="item-list">
                {rewards.map((reward) => (
                  <article className="reward-card" key={reward.id}>
                    <div className="reward-card__head">
                      <div>
                        <h3>{reward.name}</h3>
                        <p>
                          {reward.type === "FIXED_DISCOUNT"
                            ? `${Number(reward.fixedAmountMinor ?? 0).toLocaleString("en-US")} fixed discount`
                            : "Free product"}
                        </p>
                      </div>
                      <StatusBadge tone={reward.active ? "success" : "neutral"}>
                        {reward.active ? "Active" : "Paused"}
                      </StatusBadge>
                    </div>
                    <div className="meta-list">
                      <span className="meta-chip">
                        {BigInt(reward.pointsCost).toLocaleString("en-US")}{" "}
                        points
                      </span>
                      <span className="meta-chip">
                        Valid for {reward.validityDays} days
                      </span>
                      {reward.freeProductVariantGid && (
                        <span className="meta-chip">Product assigned</span>
                      )}
                    </div>
                    <div className="card-actions">
                      <Form method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <input type="hidden" name="id" value={reward.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={String(reward.active)}
                        />
                        <button className="button button--small" type="submit">
                          {reward.active ? "Pause reward" : "Enable reward"}
                        </button>
                      </Form>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="content-aside">
          <Card>
            <SectionHeader
              title="Create a reward"
              description="Choose the reward type first; only relevant fields will be shown."
            />
            <Form method="post" className="form-stack">
              <input type="hidden" name="intent" value="create" />
              <label className="field">
                <span className="field__label">Reward name</span>
                <input
                  name="name"
                  placeholder="Example: $10 voucher"
                  required
                />
              </label>
              <label className="field">
                <span className="field__label">Reward type</span>
                <select
                  name="type"
                  value={rewardType}
                  onChange={(event) => setRewardType(event.currentTarget.value)}
                >
                  <option value="FIXED_DISCOUNT">Fixed discount</option>
                  <option value="FREE_PRODUCT">Free product</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Points required</span>
                <input
                  name="pointsCost"
                  type="number"
                  min="1"
                  placeholder="500"
                  required
                />
              </label>
              {rewardType === "FIXED_DISCOUNT" ? (
                <label className="field">
                  <span className="field__label">Discount amount</span>
                  <input
                    name="fixedAmountMinor"
                    type="number"
                    min="1"
                    placeholder="50000"
                    required
                  />
                  <small>Use the store currency&apos;s minor unit.</small>
                </label>
              ) : (
                <label className="field">
                  <span className="field__label">Free product variant GID</span>
                  <input
                    name="freeProductVariantGid"
                    placeholder="gid://shopify/ProductVariant/…"
                    required
                  />
                </label>
              )}
              <label className="field">
                <span className="field__label">Validity period (days)</span>
                <input
                  name="validityDays"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue="30"
                  required
                />
              </label>
              <button
                className="button button--primary button--full"
                type="submit"
              >
                Create reward
              </button>
            </Form>
          </Card>
          <Card>
            <SectionHeader title="Redemption flow" />
            <ol className="publish-checklist">
              <li>The member selects a reward they can afford.</li>
              <li>
                The system deducts points and issues a time-limited benefit.
              </li>
              <li>The member uses the benefit before it expires.</li>
            </ol>
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
