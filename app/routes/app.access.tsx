import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
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
    return { ok: false, error: "An active plan is required to edit access rules." };
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
  return (
    <s-page heading="Product access">
      {result?.message && <s-banner tone="success">{result.message}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      <s-section heading="Active rules">
        {rules.length === 0 ? (
          <s-paragraph>No access rules configured.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {rules.map((rule) => (
              <s-grid key={rule.id} gridTemplateColumns="1fr auto" gap="base">
                <s-text>
                  {rule.name} - {rule.type}
                  {rule.minimumTierRank !== null
                    ? ` (rank ${rule.minimumTierRank}+)`
                    : ""}
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={rule.id} />
                  <s-button type="submit" tone="critical">
                    Delete
                  </s-button>
                </Form>
              </s-grid>
            ))}
          </s-stack>
        )}
      </s-section>
      <s-section heading="Create rule">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <p>
            <label>
              Name <input name="name" required />
            </label>
          </p>
          <p>
            <label>
              Requirement{" "}
              <select name="type">
                <option value="LOGIN_REQUIRED">Login required</option>
                <option value="MINIMUM_TIER">Minimum tier rank</option>
              </select>
            </label>
          </p>
          <p>
            <label>
              Minimum tier rank{" "}
              <input name="minimumTierRank" type="number" min="0" />
            </label>
          </p>
          <p>
            <label>
              Product GIDs (comma/new line)
              <textarea name="productGids" />
            </label>
          </p>
          <p>
            <label>
              Collection GIDs (max 20)
              <textarea name="collectionGids" />
            </label>
          </p>
          <p>
            <label>
              Included product tags
              <textarea name="includeTags" />
            </label>
          </p>
          <p>
            <label>
              Excluded product tags
              <textarea name="excludeTags" />
            </label>
          </p>
          <p>
            <label>
              Blocked message (VI)
              <input name="messageVi" />
            </label>
          </p>
          <p>
            <label>
              Blocked message (EN)
              <input name="messageEn" />
            </label>
          </p>
          <s-button type="submit">Add rule</s-button>
        </Form>
      </s-section>
      <s-section heading="Publish">
        <Form method="post">
          <input type="hidden" name="intent" value="publish" />
          <s-button type="submit" variant="primary">
            Publish access configuration
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
