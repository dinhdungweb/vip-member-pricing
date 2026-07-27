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
import { authenticate } from "../shopify.server";
import { ensureShop } from "../modules/shops/shop.server";
import {
  disableShopifyFunctions,
  publishShopifyFunctions,
} from "../modules/pricing/publish.server";
import { withTenant } from "../modules/shared/tenant.server";

function integer(formData: FormData, name: string): number {
  const value = Number(formData.get(name));
  if (!Number.isInteger(value))
    throw new Response(`${name} must be an integer`, { status: 400 });
  return value;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return {
    enabled: shop.programConfig?.enabled ?? false,
    goLiveAt: shop.goLiveAt ? shop.goLiveAt.toISOString().slice(0, 16) : "",
    pointsEarnNumerator: shop.programConfig?.pointsEarnNumerator ?? 1,
    pointsSpendMinor: shop.programConfig?.pointsSpendMinor.toString() ?? "1000",
    tiers: shop.tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      handle: tier.handle,
      rank: tier.rank,
      minSpendMinor: tier.minSpendMinor.toString(),
      discountBps: tier.discountBps,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const subscription = await syncManagedPricingSubscription(shop.id, admin);
  if (!subscriptionCanEdit(subscription)) {
    return {
      ok: false,
      error:
        "Choose an active Shopify pricing plan before changing program configuration.",
    };
  }

  if (intent === "program") {
    const pointsEarnNumerator = integer(formData, "pointsEarnNumerator");
    const pointsSpendMinor = BigInt(String(formData.get("pointsSpendMinor")));
    const enabled = formData.get("enabled") === "on";
    const goLiveValue = String(formData.get("goLiveAt") ?? "");
    const goLiveAt = goLiveValue ? new Date(`${goLiveValue}:00Z`) : null;

    if (
      pointsEarnNumerator <= 0 ||
      pointsSpendMinor <= 0n ||
      (enabled && (!goLiveAt || Number.isNaN(goLiveAt.valueOf())))
    ) {
      return {
        ok: false,
        error: "Point earning values and a valid go-live date are required.",
      };
    }

    if (!shop.programConfig) {
      return { ok: false, error: "Program configuration is missing." };
    }
    let functionIds = {
      discountGid: shop.programConfig.shopifyDiscountGid,
      validationGid: shop.programConfig.shopifyValidationGid,
    };
    try {
      if (enabled) {
        functionIds = await publishShopifyFunctions(
          admin,
          shop.programConfig,
          goLiveAt!,
        );
      } else {
        await disableShopifyFunctions(admin, shop.programConfig);
      }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Shopify activation failed: ${error.message}`
            : "Shopify activation failed.",
      };
    }

    await withTenant(shop.id, async (transaction) => {
      const [latestVersion, accessRules, members] = await Promise.all([
        transaction.functionConfigVersion.findFirst({
          where: { shopId: shop.id },
          orderBy: { version: "desc" },
        }),
        transaction.productAccessRule.findMany({
          where: { shopId: shop.id, enabled: true },
        }),
        transaction.member.findMany({
          where: { shopId: shop.id },
          select: { id: true },
        }),
      ]);
      const configVersion = Math.max(
        shop.programConfig!.configVersion + 1,
        (latestVersion?.version ?? 0) + 1,
      );
      await transaction.shop.update({
        where: { id: shop.id },
        data: {
          goLiveAt,
          status: enabled ? "ACTIVE" : "PAUSED",
        },
      });
      await transaction.programConfig.update({
        where: { shopId: shop.id },
        data: {
          enabled,
          goLiveAt,
          pointsEarnNumerator,
          pointsSpendMinor,
          shopifyDiscountGid: functionIds.discountGid,
          shopifyValidationGid: functionIds.validationGid,
          configVersion,
        },
      });
      const functionVersion = await transaction.functionConfigVersion.create({
        data: {
          shopId: shop.id,
          version: configVersion,
          discountConfig: {
            schemaVersion: 1,
            configVersion,
            enabled,
            allProducts: true,
            productGids: [],
          },
          accessConfig: {
            schemaVersion: 1,
            configVersion,
            enabled,
            rules: accessRules.map((rule) => ({
              productGids: rule.productGids,
              collectionGids: rule.collectionGids,
              includeTags: rule.includeTags,
              excludeTags: rule.excludeTags,
              loginRequired: rule.type === "LOGIN_REQUIRED",
              minimumTierRank: rule.minimumTierRank,
              messageVi: rule.messageVi,
              messageEn: rule.messageEn,
            })),
          },
        },
      });
      if (functionIds.discountGid && functionIds.validationGid) {
        await transaction.outboxJob.create({
          data: {
            shopId: shop.id,
            type: "PUBLISH_FUNCTION_CONFIG",
            aggregateId: functionVersion.id,
            payload: { functionConfigVersionId: functionVersion.id },
          },
        });
      }
      if (members.length) {
        await transaction.outboxJob.createMany({
          data: members.map((member) => ({
            shopId: shop.id,
            type: "SYNC_MEMBER_METAFIELD",
            aggregateId: member.id,
            payload: { memberId: member.id },
          })),
        });
      }
      await transaction.auditLog.create({
        data: {
          shopId: shop.id,
          actorType: "SHOPIFY_ADMIN",
          action: enabled ? "PROGRAM_ACTIVATED" : "PROGRAM_UPDATED",
          aggregateType: "ProgramConfig",
          aggregateId: shop.programConfig?.id,
          after: {
            enabled,
            goLiveAt: goLiveAt?.toISOString() ?? null,
            pointsEarnNumerator,
            pointsSpendMinor: pointsSpendMinor.toString(),
          },
        },
      });
    });
    return { ok: true, message: "Program settings saved." };
  }

  if (intent === "tier") {
    if (shop.tiers.length >= 10) {
      return { ok: false, error: "A maximum of 10 tiers is supported." };
    }
    const name = String(formData.get("name") ?? "").trim();
    const handle = String(formData.get("handle") ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const rank = integer(formData, "rank");
    const minSpendMinor = BigInt(String(formData.get("minSpendMinor")));
    const discountBps = integer(formData, "discountBps");

    if (
      !name ||
      !handle ||
      minSpendMinor < 0n ||
      discountBps < 0 ||
      discountBps > 10_000
    ) {
      return { ok: false, error: "Tier values are invalid." };
    }

    await withTenant(shop.id, (transaction) => {
      return transaction.tier.create({
        data: {
          shopId: shop.id,
          name,
          handle,
          rank,
          minSpendMinor,
          discountBps,
        },
      });
    });
    return { ok: true, message: "Tier created." };
  }

  if (intent === "tier-update") {
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const rank = integer(formData, "rank");
    const minSpendMinor = BigInt(String(formData.get("minSpendMinor")));
    const discountBps = integer(formData, "discountBps");
    if (
      !name ||
      minSpendMinor < 0n ||
      discountBps < 0 ||
      discountBps > 10_000
    ) {
      return { ok: false, error: "Tier values are invalid." };
    }
    try {
      const updated = await withTenant(shop.id, async (transaction) => {
        const before = await transaction.tier.findFirst({
          where: { id, shopId: shop.id },
        });
        if (!before || (before.minSpendMinor === 0n && minSpendMinor !== 0n)) {
          return false;
        }
        const after = await transaction.tier.update({
          where: { id },
          data: { name, rank, minSpendMinor, discountBps },
        });
        const members = await transaction.member.findMany({
          where: { shopId: shop.id, currentTierId: id },
          select: { id: true },
        });
        if (members.length) {
          await transaction.outboxJob.createMany({
            data: members.map((member) => ({
              shopId: shop.id,
              type: "SYNC_MEMBER_METAFIELD",
              aggregateId: member.id,
              payload: { memberId: member.id },
            })),
          });
        }
        await transaction.auditLog.create({
          data: {
            shopId: shop.id,
            actorType: "SHOPIFY_ADMIN",
            action: "TIER_UPDATED",
            aggregateType: "Tier",
            aggregateId: id,
            before: {
              name: before.name,
              rank: before.rank,
              minSpendMinor: before.minSpendMinor.toString(),
              discountBps: before.discountBps,
            },
            after: {
              name: after.name,
              rank: after.rank,
              minSpendMinor: after.minSpendMinor.toString(),
              discountBps: after.discountBps,
            },
          },
        });
        return true;
      });
      return updated
        ? { ok: true, message: "Tier updated." }
        : { ok: false, error: "Tier was not found." };
    } catch {
      return {
        ok: false,
        error: "Tier rank must be unique and thresholds must remain valid.",
      };
    }
  }

  if (intent === "tier-delete") {
    const id = String(formData.get("id") ?? "");
    const deleted = await withTenant(shop.id, async (transaction) => {
      const tier = await transaction.tier.findFirst({
        where: { id, shopId: shop.id },
        include: {
          _count: { select: { members: true, rewards: true } },
        },
      });
      if (
        !tier ||
        tier.minSpendMinor === 0n ||
        tier._count.members > 0 ||
        tier._count.rewards > 0
      ) {
        return false;
      }
      await transaction.tier.delete({ where: { id } });
      await transaction.auditLog.create({
        data: {
          shopId: shop.id,
          actorType: "SHOPIFY_ADMIN",
          action: "TIER_DELETED",
          aggregateType: "Tier",
          aggregateId: id,
          before: {
            name: tier.name,
            rank: tier.rank,
            minSpendMinor: tier.minSpendMinor.toString(),
            discountBps: tier.discountBps,
          },
        },
      });
      return true;
    });
    return deleted
      ? { ok: true, message: "Tier deleted." }
      : {
          ok: false,
          error:
            "The base tier or a tier assigned to members/rewards cannot be deleted.",
        };
  }

  return { ok: false, error: "Unknown action." };
};

export default function ProgramRoute() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  return (
    <s-page heading="Program configuration">
      {result?.message && <s-banner tone="success">{result.message}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

      <s-section heading="Earning and activation">
        <Form method="post">
          <input type="hidden" name="intent" value="program" />
          <p>
            <label>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={data.enabled}
              />{" "}
              Activate program
            </label>
          </p>
          <p>
            <label>
              Program start (UTC)
              <input
                name="goLiveAt"
                type="datetime-local"
                defaultValue={data.goLiveAt}
              />
            </label>
          </p>
          <p>
            <label>
              Points earned
              <input
                name="pointsEarnNumerator"
                type="number"
                min="1"
                defaultValue={data.pointsEarnNumerator}
              />
            </label>
          </p>
          <p>
            <label>
              Per spend amount in minor units
              <input
                name="pointsSpendMinor"
                type="number"
                min="1"
                defaultValue={data.pointsSpendMinor}
              />
            </label>
          </p>
          <s-button type="submit" variant="primary">
            Save program
          </s-button>
        </Form>
      </s-section>

      <s-section heading="Membership tiers">
        <s-stack direction="block" gap="base">
          {data.tiers.map((tier) => (
            <Form method="post" key={tier.id}>
              <input type="hidden" name="id" value={tier.id} />
              <input name="name" defaultValue={tier.name} required />{" "}
              <input
                name="rank"
                type="number"
                min="0"
                defaultValue={tier.rank}
                required
              />{" "}
              <input
                name="minSpendMinor"
                type="number"
                min="0"
                defaultValue={tier.minSpendMinor}
                required
              />{" "}
              <input
                name="discountBps"
                type="number"
                min="0"
                max="10000"
                defaultValue={tier.discountBps}
                required
              />{" "}
              <button type="submit" name="intent" value="tier-update">
                Save
              </button>{" "}
              {tier.minSpendMinor !== "0" && (
                <button type="submit" name="intent" value="tier-delete">
                  Delete
                </button>
              )}
            </Form>
          ))}
        </s-stack>
        <Form method="post">
          <input type="hidden" name="intent" value="tier" />
          <p>
            <label>
              Name <input name="name" required />
            </label>
          </p>
          <p>
            <label>
              Handle <input name="handle" required />
            </label>
          </p>
          <p>
            <label>
              Rank <input name="rank" type="number" min="0" required />
            </label>
          </p>
          <p>
            <label>
              Spend threshold{" "}
              <input name="minSpendMinor" type="number" min="0" required />
            </label>
          </p>
          <p>
            <label>
              Discount basis points{" "}
              <input
                name="discountBps"
                type="number"
                min="0"
                max="10000"
                required
              />
            </label>
          </p>
          <s-button type="submit">Add tier</s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
