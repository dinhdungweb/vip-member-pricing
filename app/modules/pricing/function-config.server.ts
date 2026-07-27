import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "../../generated/prisma/client.js";
import { unauthenticated } from "../../shopify.server";
import { withTenant } from "../shared/tenant.server";

type AccessRuleContract = {
  productGids?: string[];
  collectionGids?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  [key: string]: unknown;
};

type CatalogProduct = {
  id: string;
  tags: string[];
  collections: { nodes: Array<{ id: string }> };
};

function normalizeContract(
  value: unknown,
  version: number,
  enabled: boolean,
): Record<string, unknown> {
  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    ...object,
    schemaVersion: 1,
    configVersion: version,
    enabled,
  };
}

function lower(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.toLocaleLowerCase());
}

function ruleMatchesProduct(
  rule: AccessRuleContract,
  product: CatalogProduct,
): boolean {
  const productGids = rule.productGids ?? [];
  const collectionGids = rule.collectionGids ?? [];
  const includeTags = lower(rule.includeTags);
  const excludeTags = lower(rule.excludeTags);
  const tags = lower(product.tags);
  if (excludeTags.some((tag) => tags.includes(tag))) return false;
  const hasSelector =
    productGids.length > 0 ||
    collectionGids.length > 0 ||
    includeTags.length > 0;
  return (
    !hasSelector ||
    productGids.includes(product.id) ||
    product.collections.nodes.some((collection) =>
      collectionGids.includes(collection.id),
    ) ||
    includeTags.some((tag) => tags.includes(tag))
  );
}

async function loadCatalogProducts(
  admin: AdminApiContext,
): Promise<CatalogProduct[]> {
  const products: CatalogProduct[] = [];
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(
      `#graphql
        query ResolveAccessProducts($cursor: String) {
          products(first: 40, after: $cursor) {
            nodes {
              id
              tags
              collections(first: 20) { nodes { id } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { variables: { cursor } },
    );
    const body = (await response.json()) as {
      data?: {
        products?: {
          nodes?: CatalogProduct[];
          pageInfo?: {
            hasNextPage: boolean;
            endCursor?: string | null;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      throw new Error(body.errors.map((error) => error.message).join("; "));
    }
    products.push(...(body.data?.products?.nodes ?? []));
    const pageInfo = body.data?.products?.pageInfo;
    cursor =
      pageInfo?.hasNextPage && pageInfo.endCursor ? pageInfo.endCursor : null;
  } while (cursor);
  return products;
}

async function resolveAccessConfig(
  admin: AdminApiContext,
  accessConfig: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const rules = Array.isArray(accessConfig.rules)
    ? (accessConfig.rules as AccessRuleContract[])
    : [];
  const hasDynamicSelectors = rules.some(
    (rule) =>
      (rule.collectionGids?.length ?? 0) > 0 ||
      (rule.includeTags?.length ?? 0) > 0 ||
      (rule.excludeTags?.length ?? 0) > 0 ||
      ((rule.productGids?.length ?? 0) === 0 &&
        (rule.collectionGids?.length ?? 0) === 0 &&
        (rule.includeTags?.length ?? 0) === 0),
  );
  if (!hasDynamicSelectors) return accessConfig;

  const products = await loadCatalogProducts(admin);
  const resolved = {
    ...accessConfig,
    rules: rules.map((rule) => ({
      ...rule,
      productGids: products
        .filter((product) => ruleMatchesProduct(rule, product))
        .map((product) => product.id),
    })),
  };
  const encoded = JSON.stringify(resolved);
  if (encoded.length > 1_500_000) {
    throw new Error(
      "Resolved product access config is too large; narrow collection/tag rules",
    );
  }
  return resolved;
}

export async function publishFunctionConfigVersion(
  shopId: string,
  configVersionId: string,
): Promise<void> {
  const state = await withTenant(shopId, async (transaction) => {
    const [version, program, shop] = await Promise.all([
      transaction.functionConfigVersion.findFirst({
        where: { id: configVersionId, shopId },
      }),
      transaction.programConfig.findUnique({ where: { shopId } }),
      transaction.shop.findUnique({ where: { id: shopId } }),
    ]);
    return { version, program, shop };
  });
  if (!state.version || !state.program || !state.shop) {
    throw new Error("Function configuration state is incomplete");
  }
  if (
    !state.program.shopifyDiscountGid ||
    !state.program.shopifyValidationGid
  ) {
    throw new Error("Activate the program before publishing Function config");
  }

  const discountConfig = normalizeContract(
    state.version.discountConfig,
    state.version.version,
    state.program.enabled,
  );
  const accessConfigDraft = normalizeContract(
    state.version.accessConfig,
    state.version.version,
    state.program.enabled,
  );
  const { admin } = await unauthenticated.admin(state.shop.domain);
  const accessConfig = await resolveAccessConfig(admin, accessConfigDraft);
  const response = await admin.graphql(
    `#graphql
      mutation PublishVipFunctionConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { code field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: state.program.shopifyDiscountGid,
            namespace: "$app:vip_pricing",
            key: "discount_config",
            type: "json",
            value: JSON.stringify(discountConfig),
          },
          {
            ownerId: state.program.shopifyValidationGid,
            namespace: "$app:vip_pricing",
            key: "access_config",
            type: "json",
            value: JSON.stringify(accessConfig),
          },
        ],
      },
    },
  );
  const body = (await response.json()) as {
    data?: {
      metafieldsSet?: {
        userErrors?: Array<{ message: string }>;
      };
    };
  };
  const errors = body.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  await withTenant(shopId, async (transaction) => {
    await transaction.functionConfigVersion.update({
      where: { id: state.version!.id },
      data: {
        accessConfig: accessConfig as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
    });
    await transaction.programConfig.update({
      where: { shopId },
      data: { configVersion: state.version!.version },
    });
  });
}
