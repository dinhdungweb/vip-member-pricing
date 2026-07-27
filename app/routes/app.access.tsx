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
  PageHeader,
  SectionHeader,
  StatusBadge,
} from "../components/ui";

function list(value: FormDataEntryValue | null): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const rules = await withTenant(shop.id, (transaction) =>
    transaction.productAccessRule.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
    }),
  );
  return {
    rules: rules.map((rule) => ({
      ...rule,
      createdAt: rule.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const subscription = await syncManagedPricingSubscription(shop.id, admin);
  if (!subscriptionCanEdit(subscription)) {
    return {
      ok: false,
      error: "An active plan is required to edit access rules.",
    };
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type"));
    const productGids = list(formData.get("productGids"));
    const collectionGids = list(formData.get("collectionGids"));
    const includeTags = list(formData.get("includeTags"));
    const excludeTags = list(formData.get("excludeTags"));
    const messageVi = String(formData.get("messageVi") ?? "").trim();
    const messageEn = String(formData.get("messageEn") ?? "").trim();
    const minimumTierRank =
      type === "MINIMUM_TIER" ? Number(formData.get("minimumTierRank")) : null;
    if (
      !name ||
      !["LOGIN_REQUIRED", "MINIMUM_TIER"].includes(type) ||
      productGids.length > 100 ||
      collectionGids.length > 20 ||
      (type === "MINIMUM_TIER" &&
        (!Number.isInteger(minimumTierRank) || minimumTierRank! < 0))
    ) {
      return { ok: false, error: "Access rule values exceed MVP limits." };
    }
    await withTenant(shop.id, (transaction) =>
      transaction.productAccessRule.create({
        data: {
          shopId: shop.id,
          name,
          type: type as "LOGIN_REQUIRED" | "MINIMUM_TIER",
          minimumTierRank,
          productGids,
          collectionGids,
          includeTags,
          excludeTags,
          ...(messageVi ? { messageVi } : {}),
          ...(messageEn ? { messageEn } : {}),
        },
      }),
    );
    return { ok: true, message: "Access rule created." };
  }

  if (intent === "delete") {
    const id = String(formData.get("id"));
    await withTenant(shop.id, (transaction) =>
      transaction.productAccessRule.deleteMany({
        where: { id, shopId: shop.id },
      }),
    );
    return { ok: true, message: "Access rule deleted." };
  }

  if (intent === "publish") {
    await withTenant(shop.id, async (transaction) => {
      const [rules, latest] = await Promise.all([
        transaction.productAccessRule.findMany({
          where: { shopId: shop.id, enabled: true },
        }),
        transaction.functionConfigVersion.findFirst({
          where: { shopId: shop.id },
          orderBy: { version: "desc" },
        }),
      ]);
      const version = (latest?.version ?? 0) + 1;
      const accessConfig = {
        schemaVersion: 1,
        configVersion: version,
        enabled: true,
        rules: rules.map((rule) => ({
          productGids: rule.productGids,
          collectionGids: rule.collectionGids,
          includeTags: rule.includeTags,
          excludeTags: rule.excludeTags,
          loginRequired: rule.type === "LOGIN_REQUIRED",
          minimumTierRank: rule.minimumTierRank,
          messageVi: rule.messageVi,
          messageEn: rule.messageEn,
        })),
      };
      const config = await transaction.functionConfigVersion.create({
        data: {
          shopId: shop.id,
          version,
          discountConfig: latest?.discountConfig ?? {
            schemaVersion: 1,
            configVersion: version,
            enabled: false,
          },
          accessConfig,
        },
      });
      await transaction.outboxJob.create({
        data: {
          shopId: shop.id,
          type: "PUBLISH_FUNCTION_CONFIG",
          aggregateId: config.id,
          payload: { functionConfigVersionId: config.id },
        },
      });
    });
    return { ok: true, message: "Configuration queued for publishing." };
  }

  return { ok: false, error: "Unknown action." };
};

export default function ProductAccessRoute() {
  const { rules } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [ruleType, setRuleType] = useState("LOGIN_REQUIRED");

  return (
    <main className="app-page">
      <PageHeader
        eyebrow="Step 3 of 4"
        title="Product access"
        description="Restrict products or collections by sign-in status and membership tier."
        actions={<StatusBadge tone="info">{rules.length} rules</StatusBadge>}
      />

      {result?.message && <Alert tone="success">{result.message}</Alert>}
      {result?.error && <Alert tone="danger">{result.error}</Alert>}

      <div className="content-grid content-grid--wide-aside">
        <div className="content-main">
          <Card>
            <SectionHeader
              title="Current rules"
              description="Saved rules take effect only after you publish the configuration."
            />
            {rules.length === 0 ? (
              <EmptyState
                title="No access rules yet"
                description="Create the first rule with the form below, then publish it."
              />
            ) : (
              <div className="item-list">
                {rules.map((rule) => (
                  <article className="rule-card" key={rule.id}>
                    <div className="rule-card__head">
                      <div>
                        <h3>{rule.name}</h3>
                        <p>
                          {rule.type === "LOGIN_REQUIRED"
                            ? "Customer must sign in"
                            : `Requires rank ${rule.minimumTierRank}+`}
                        </p>
                      </div>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={rule.id} />
                        <button
                          className="button button--danger button--small"
                          type="submit"
                        >
                          Delete
                        </button>
                      </Form>
                    </div>
                    <div className="meta-list">
                      <span className="meta-chip">
                        {rule.productGids.length} products
                      </span>
                      <span className="meta-chip">
                        {rule.collectionGids.length} collections
                      </span>
                      <span className="meta-chip">
                        {rule.includeTags.length} included tags
                      </span>
                      <span className="meta-chip">
                        {rule.excludeTags.length} excluded tags
                      </span>
                      <StatusBadge tone={rule.enabled ? "success" : "neutral"}>
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeader
              title="Create a new rule"
              description="1. Choose a requirement → 2. Set the scope → 3. Write the message."
            />
            <Form method="post" className="form-stack">
              <input type="hidden" name="intent" value="create" />
              <div className="form-grid">
                <label className="field">
                  <span className="field__label">Rule name</span>
                  <input
                    name="name"
                    placeholder="Example: Gold VIP collection"
                    required
                  />
                </label>
                <label className="field">
                  <span className="field__label">Access requirement</span>
                  <select
                    name="type"
                    value={ruleType}
                    onChange={(event) => setRuleType(event.currentTarget.value)}
                  >
                    <option value="LOGIN_REQUIRED">Sign-in required</option>
                    <option value="MINIMUM_TIER">Minimum tier rank</option>
                  </select>
                </label>
                {ruleType === "MINIMUM_TIER" && (
                  <label className="field">
                    <span className="field__label">Minimum tier rank</span>
                    <input
                      name="minimumTierRank"
                      type="number"
                      min="0"
                      required
                    />
                    <small>
                      For example, enter 2 to allow rank 2 and above.
                    </small>
                  </label>
                )}
              </div>

              <hr className="divider" />
              <SectionHeader
                title="Rule scope"
                description="Separate values with commas or new lines."
              />
              <div className="form-grid">
                <label className="field">
                  <span className="field__label">Product GID</span>
                  <textarea
                    name="productGids"
                    placeholder="gid://shopify/Product/…"
                  />
                  <small>Up to 100 products.</small>
                </label>
                <label className="field">
                  <span className="field__label">Collection GID</span>
                  <textarea
                    name="collectionGids"
                    placeholder="gid://shopify/Collection/…"
                  />
                  <small>Up to 20 collections.</small>
                </label>
                <label className="field">
                  <span className="field__label">Included product tags</span>
                  <textarea
                    name="includeTags"
                    placeholder="vip-only, early-access"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Excluded product tags</span>
                  <textarea
                    name="excludeTags"
                    placeholder="clearance, preorder"
                  />
                </label>
              </div>

              <hr className="divider" />
              <SectionHeader
                title="Blocked message"
                description="Briefly explain what the customer should do next."
              />
              <div className="form-grid">
                <label className="field">
                  <span className="field__label">Vietnamese</span>
                  <input
                    name="messageVi"
                    placeholder="Please sign in to continue."
                  />
                </label>
                <label className="field">
                  <span className="field__label">English</span>
                  <input
                    name="messageEn"
                    placeholder="Please sign in to continue."
                  />
                </label>
              </div>
              <div className="form-footer">
                <p>The rule will be saved and ready to publish.</p>
                <button className="button button--primary" type="submit">
                  Add rule
                </button>
              </div>
            </Form>
          </Card>
        </div>

        <aside className="content-aside">
          <Card className="card--accent">
            <SectionHeader
              title="Publish to Shopify"
              description="Send all enabled rules to the cart validation flow."
            />
            <ol className="publish-checklist">
              <li>Review the product and collection scope.</li>
              <li>Confirm tier ranks match the Program page.</li>
              <li>Publish, then test with a customer account.</li>
            </ol>
            <Form method="post">
              <input type="hidden" name="intent" value="publish" />
              <button
                className="button button--primary button--full"
                type="submit"
              >
                Publish configuration
              </button>
            </Form>
          </Card>
          <Card>
            <SectionHeader title="Evaluation order" />
            <ul className="plain-list">
              <li>
                <strong>1.</strong> Determine whether the product is in scope.
              </li>
              <li>
                <strong>2.</strong> Check sign-in status or tier rank.
              </li>
              <li>
                <strong>3.</strong> Allow purchase or show the blocked message.
              </li>
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
