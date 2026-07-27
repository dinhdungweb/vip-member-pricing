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
import type { Prisma } from "../generated/prisma/client.js";
import {
  subscriptionCanEdit,
  syncManagedPricingSubscription,
} from "../modules/billing/subscription.server";
import { ensureShop } from "../modules/shops/shop.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";
import { Alert, Card, PageHeader, SectionHeader } from "../components/ui";

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
  const [position, setPosition] = useState(settings.position);
  const [background, setBackground] = useState(settings.background);
  const [foreground, setForeground] = useState(settings.foreground);
  const [borderRadius, setBorderRadius] = useState(settings.borderRadiusPx);

  return (
    <main className="app-page">
      <PageHeader
        eyebrow="Storefront"
        title="VIP badge appearance"
        description="Customize how the member badge appears on product cards and preview changes before saving."
      />

      {result?.message && <Alert tone="success">{result.message}</Alert>}
      {result?.error && <Alert tone="danger">{result.error}</Alert>}

      <Form method="post" className="content-grid content-grid--wide-aside">
        <div className="content-main">
          <Card>
            <SectionHeader
              title="Badge styling"
              description="Changes are reflected immediately in the preview."
            />
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Badge position</span>
                <select
                  name="position"
                  value={position}
                  onChange={(event) => setPosition(event.currentTarget.value)}
                >
                  <option value="top-left">Top left</option>
                  <option value="top-right">Top right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Corner radius</span>
                <input
                  name="borderRadiusPx"
                  type="number"
                  min="0"
                  max="40"
                  value={borderRadius}
                  onChange={(event) =>
                    setBorderRadius(Number(event.currentTarget.value))
                  }
                />
                <small>From 0 to 40 px.</small>
              </label>
              <label className="field color-field">
                <span className="field__label">Background color</span>
                <span className="color-control">
                  <input
                    name="background"
                    type="color"
                    value={background}
                    onChange={(event) =>
                      setBackground(event.currentTarget.value)
                    }
                  />
                  <code>{background}</code>
                </span>
              </label>
              <label className="field color-field">
                <span className="field__label">Text color</span>
                <span className="color-control">
                  <input
                    name="foreground"
                    type="color"
                    value={foreground}
                    onChange={(event) =>
                      setForeground(event.currentTarget.value)
                    }
                  />
                  <code>{foreground}</code>
                </span>
              </label>
            </div>
          </Card>

          <Card>
            <SectionHeader
              title="Third-party theme compatibility"
              description="Edit this only when the theme does not use standard product markup."
            />
            <details className="advanced-panel">
              <summary>Open advanced selector configuration</summary>
              <label className="field advanced-panel__content">
                <span className="field__label">Selector map (JSON)</span>
                <textarea
                  className="code-field"
                  name="customSelectors"
                  rows={10}
                  defaultValue={settings.customSelectors}
                  spellCheck={false}
                />
                <small>
                  Must be a valid JSON object. Incorrect selectors can prevent
                  the badge from appearing.
                </small>
              </label>
            </details>
          </Card>

          <div className="save-bar">
            <p>Save to apply this appearance to the storefront.</p>
            <button className="button button--primary" type="submit">
              Save appearance
            </button>
          </div>
        </div>

        <aside className="content-aside">
          <Card>
            <SectionHeader
              title="Preview"
              description="A storefront product-card simulation."
            />
            <div className="preview-panel">
              <div className="product-preview">
                <span
                  className={`badge-preview badge-preview--${position}`}
                  style={{
                    background,
                    color: foreground,
                    borderRadius: `${borderRadius}px`,
                  }}
                >
                  VIP PRICE
                </span>
                <div className="product-preview__image" />
                <div className="product-preview__line" />
                <div className="product-preview__line product-preview__line--short" />
              </div>
            </div>
          </Card>
          <Card>
            <SectionHeader title="Discount combination policy" />
            <ul className="help-list">
              <li>Catalog sales use price and compare-at price.</li>
              <li>The member discount is based on compare-at price.</li>
              <li>Other product discounts do not combine.</li>
              <li>Shipping discounts may be combined.</li>
            </ul>
          </Card>
        </aside>
      </Form>
    </main>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
