import type { LoaderFunctionArgs } from "react-router";
import {
  getMemberSnapshot,
  publicMemberJson,
} from "../modules/members/member.server";
import db from "../db.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return Response.json({ error: "App is not installed" }, { status: 401 });
  }
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  const handles = [
    ...new Set(
      (url.searchParams.get("handles") ?? "")
        .split(",")
        .map((handle) => handle.trim().toLowerCase())
        .filter((handle) => /^[a-z0-9][a-z0-9-]*$/.test(handle)),
    ),
  ].slice(0, 100);
  const snapshot = publicMemberJson(
    await getMemberSnapshot(session.shop, customerId),
  );
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const accessRules = shop
    ? await withTenant(shop.id, async (transaction) => {
        const published = await transaction.functionConfigVersion.findFirst({
          where: { shopId: shop.id, publishedAt: { not: null } },
          orderBy: { version: "desc" },
          select: { accessConfig: true },
        });
        const config = published?.accessConfig as {
          enabled?: boolean;
          rules?: unknown[];
        } | null;
        return config?.enabled ? (config.rules ?? []) : [];
      })
    : [];
  const products: unknown[] = [];
  let currencyCode: string | null = null;
  if (handles.length > 0) {
    for (let index = 0; index < handles.length; index += 40) {
      const batch = handles.slice(index, index + 40);
      const response = await admin.graphql(
        `#graphql
          query PricingContext($query: String!) {
            shop { currencyCode }
            products(first: 40, query: $query) {
              nodes {
                id
                handle
                variants(first: 20) {
                  nodes { id price compareAtPrice availableForSale }
                }
              }
            }
          }`,
        {
          variables: {
            query: batch.map((handle) => `handle:${handle}`).join(" OR "),
          },
        },
      );
      const result = (await response.json()) as {
        data?: {
          shop?: { currencyCode?: string };
          products?: { nodes?: unknown[] };
        };
      };
      currencyCode ??= result.data?.shop?.currencyCode ?? null;
      products.push(...(result.data?.products?.nodes ?? []));
    }
  }
  return Response.json(
    {
      ...(snapshot ?? {
        enabled: false,
        authenticated: false,
        tier: null,
      }),
      currencyCode,
      products,
      accessRules,
    },
    {
      headers: {
        "Cache-Control": customerId
          ? "private, no-store"
          : "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
};
