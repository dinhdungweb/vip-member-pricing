import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "../generated/prisma/client.js";
import {
  subscriptionCanEdit,
  syncManagedPricingSubscription,
} from "../modules/billing/subscription.server";
import { ensureShop } from "../modules/shops/shop.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";

const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await withTenant(shop.id, (transaction) =>
    transaction.programConfig.findUnique({ where: { shopId: shop.id } }),
  );
  return {
    position: config?.badgePosition ?? "top-left",
    background: config?.badgeBackground ?? "#f5f5f5",
    foreground: config?.badgeForeground ?? "#111111",
    borderRadiusPx: config?.badgeBorderRadiusPx ?? 0,
    customSelectors: JSON.stringify(config?.customSelectors ?? {}, null, 2),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const subscription = await syncManagedPricingSubscription(shop.id, admin);
  if (!subscriptionCanEdit(subscription)) {
    return { ok: false, error: "An active plan is required to edit settings." };
  }
  const formData = await request.formData();
  const position = String(formData.get("position") ?? "");
  const background = String(formData.get("background") ?? "").trim();
  const foreground = String(formData.get("foreground") ?? "").trim();
  const borderRadiusPx = Number(formData.get("borderRadiusPx") ?? 0);
  let customSelectors: Record<string, unknown>;
  try {
    const value = JSON.parse(String(formData.get("customSelectors") ?? "{}"));
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("Selectors must be a JSON object");
    }
    customSelectors = value;
  } catch {
    return { ok: false, error: "Custom selectors must be valid JSON." };
  }
  if (
    !POSITIONS.includes(position) ||
    !HEX_COLOR.test(background) ||
    !HEX_COLOR.test(foreground) ||
    !Number.isInteger(borderRadiusPx) ||
    borderRadiusPx < 0 ||
    borderRadiusPx > 40
  ) {
    return { ok: false, error: "Badge settings are invalid." };
  }
  await withTenant(shop.id, async (transaction) => {
    const before = await transaction.programConfig.findUnique({
      where: { shopId: shop.id },
    });
    const after = await transaction.programConfig.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        badgePosition: position,
        badgeBackground: background,
        badgeForeground: foreground,
        badgeBorderRadiusPx: borderRadiusPx,
        customSelectors: customSelectors as Prisma.InputJsonValue,
      },
      update: {
        badgePosition: position,
        badgeBackground: background,
        badgeForeground: foreground,
        badgeBorderRadiusPx: borderRadiusPx,
        customSelectors: customSelectors as Prisma.InputJsonValue,
      },
    });
    await transaction.auditLog.create({
      data: {
        shopId: shop.id,
        actorType: "MERCHANT",
        action: "PROGRAM_APPEARANCE_UPDATED",
        aggregateType: "ProgramConfig",
        aggregateId: after.id,
        before: before
          ? {
              badgePosition: before.badgePosition,
              badgeBackground: before.badgeBackground,
              badgeForeground: before.badgeForeground,
              badgeBorderRadiusPx: before.badgeBorderRadiusPx,
              customSelectors: before.customSelectors,
            }
          : undefined,
        after: {
          badgePosition: after.badgePosition,
          badgeBackground: after.badgeBackground,
          badgeForeground: after.badgeForeground,
          badgeBorderRadiusPx: after.badgeBorderRadiusPx,
          customSelectors: after.customSelectors,
        },
      },
    });
  });
  return { ok: true, message: "Storefront settings saved." };
};

export default function SettingsRoute() {
  const settings = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <s-page heading="Settings">
      {result?.message && <s-banner tone="success">{result.message}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      <s-section heading="Badge and theme adapter">
        <Form method="post">
          <p>
            <label>
              Position{" "}
              <select name="position" defaultValue={settings.position}>
                {POSITIONS.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Background{" "}
              <input
                name="background"
                type="color"
                defaultValue={settings.background}
              />
            </label>
          </p>
          <p>
            <label>
              Text color{" "}
              <input
                name="foreground"
                type="color"
                defaultValue={settings.foreground}
              />
            </label>
          </p>
          <p>
            <label>
              Border radius (px){" "}
              <input
                name="borderRadiusPx"
                type="number"
                min="0"
                max="40"
                defaultValue={settings.borderRadiusPx}
              />
            </label>
          </p>
          <p>
            <label>
              Third-party theme selector map
              <br />
              <textarea
                name="customSelectors"
                rows={10}
                defaultValue={settings.customSelectors}
              />
            </label>
          </p>
          <s-button type="submit" variant="primary">
            Save settings
          </s-button>
        </Form>
      </s-section>
      <s-section heading="Discount combination policy">
        <s-unordered-list>
          <s-list-item>Catalog sale uses price and compare-at price.</s-list-item>
          <s-list-item>Member discount is based on compare-at price.</s-list-item>
          <s-list-item>Other product discounts do not combine.</s-list-item>
          <s-list-item>Shipping discounts may combine.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
