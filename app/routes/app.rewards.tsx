import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  subscriptionCanEdit,
  syncManagedPricingSubscription,
} from "../modules/billing/subscription.server";
import { ensureShop } from "../modules/shops/shop.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";

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
      (type === "FIXED_DISCOUNT" && (!fixedAmountMinor || fixedAmountMinor <= 0n)) ||
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
  return (
    <s-page heading="Rewards">
      {result?.message && <s-banner tone="success">{result.message}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      <s-section heading="Reward catalog">
        {rewards.length === 0 ? (
          <s-paragraph>No rewards configured.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {rewards.map((reward) => (
              <s-grid key={reward.id} gridTemplateColumns="1fr auto" gap="base">
                <s-text>
                  {reward.name} - {reward.pointsCost} points -{" "}
                  {reward.active ? "Active" : "Inactive"}
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="toggle" />
                  <input type="hidden" name="id" value={reward.id} />
                  <input type="hidden" name="active" value={String(reward.active)} />
                  <s-button type="submit">
                    {reward.active ? "Disable" : "Enable"}
                  </s-button>
                </Form>
              </s-grid>
            ))}
          </s-stack>
        )}
      </s-section>
      <s-section heading="Create reward">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <p><label>Name <input name="name" required /></label></p>
          <p>
            <label>
              Type{" "}
              <select name="type">
                <option value="FIXED_DISCOUNT">Fixed discount</option>
                <option value="FREE_PRODUCT">Free product</option>
              </select>
            </label>
          </p>
          <p><label>Points cost <input name="pointsCost" type="number" min="1" required /></label></p>
          <p><label>Fixed amount (minor units) <input name="fixedAmountMinor" type="number" min="0" /></label></p>
          <p><label>Free variant GID <input name="freeProductVariantGid" /></label></p>
          <p><label>Validity days <input name="validityDays" type="number" min="1" max="365" defaultValue="30" /></label></p>
          <s-button type="submit" variant="primary">Create reward</s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
