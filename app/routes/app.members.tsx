import { randomUUID } from "node:crypto";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ensureShop } from "../modules/shops/shop.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const { members, tiers } = await withTenant(shop.id, async (transaction) => ({
    members: await transaction.member.findMany({
      where: { shopId: shop.id },
      include: { currentTier: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    tiers: await transaction.tier.findMany({
      where: { shopId: shop.id },
      orderBy: { rank: "asc" },
    }),
  }));
  return {
    tiers: tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      rank: tier.rank,
    })),
    members: members.map((member) => ({
      id: member.id,
      customerGid: member.customerGid,
      tierId: member.currentTierId,
      tierName: member.currentTier?.name ?? "Unassigned",
      netSpendMinor: member.netSpendMinor.toString(),
      pointsBalance: member.pointsBalance.toString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const memberId = String(formData.get("memberId") ?? "");

  if (intent === "tier") {
    const tierId = String(formData.get("tierId") ?? "");
    const result = await withTenant(shop.id, async (transaction) => {
      const [member, tier] = await Promise.all([
        transaction.member.findFirst({
          where: { id: memberId, shopId: shop.id },
        }),
        transaction.tier.findFirst({
          where: { id: tierId, shopId: shop.id },
        }),
      ]);
      if (!member || !tier) return false;
      await transaction.member.update({
        where: { id: member.id },
        data: {
          currentTierId: tier.id,
          stateVersion: { increment: 1 },
        },
      });
      await transaction.auditLog.create({
        data: {
          shopId: shop.id,
          actorType: "SHOPIFY_ADMIN",
          action: "MEMBER_TIER_OVERRIDDEN",
          aggregateType: "Member",
          aggregateId: member.id,
          before: { currentTierId: member.currentTierId },
          after: { currentTierId: tier.id },
        },
      });
      await transaction.outboxJob.create({
        data: {
          shopId: shop.id,
          type: "SYNC_MEMBER_METAFIELD",
          aggregateId: member.id,
          payload: { memberId: member.id },
        },
      });
      return true;
    });
    return result
      ? { ok: true, message: "Member tier updated." }
      : { ok: false, error: "Member or tier was not found." };
  }

  if (intent === "points") {
    let delta: bigint;
    try {
      delta = BigInt(String(formData.get("delta") ?? ""));
    } catch {
      return { ok: false, error: "Point adjustment must be an integer." };
    }
    if (delta === 0n) {
      return { ok: false, error: "Point adjustment cannot be zero." };
    }
    const result = await withTenant(shop.id, async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{ id: string; pointsBalance: bigint }>
      >`
        SELECT "id", "pointsBalance"
        FROM "Member"
        WHERE "id" = ${memberId}::uuid
          AND "shopId" = ${shop.id}::uuid
        FOR UPDATE
      `;
      const member = rows[0];
      if (!member) return false;
      const balanceAfter = member.pointsBalance + delta;
      if (balanceAfter < 0n) return false;
      const adjustmentId = randomUUID();
      await transaction.member.update({
        where: { id: member.id },
        data: {
          pointsBalance: balanceAfter,
          stateVersion: { increment: 1 },
        },
      });
      await transaction.pointsLedger.create({
        data: {
          shopId: shop.id,
          memberId: member.id,
          type: "MANUAL_ADJUSTMENT",
          delta,
          balanceAfter,
          referenceGid: adjustmentId,
          idempotencyKey: `manual-adjustment:${adjustmentId}`,
        },
      });
      await transaction.auditLog.create({
        data: {
          shopId: shop.id,
          actorType: "SHOPIFY_ADMIN",
          action: "MEMBER_POINTS_ADJUSTED",
          aggregateType: "Member",
          aggregateId: member.id,
          before: { pointsBalance: member.pointsBalance.toString() },
          after: {
            pointsBalance: balanceAfter.toString(),
            delta: delta.toString(),
          },
        },
      });
      await transaction.outboxJob.create({
        data: {
          shopId: shop.id,
          type: "SYNC_MEMBER_METAFIELD",
          aggregateId: member.id,
          payload: { memberId: member.id },
        },
      });
      return true;
    });
    return result
      ? { ok: true, message: "Member points adjusted." }
      : { ok: false, error: "Member not found or balance would be negative." };
  }

  return { ok: false, error: "Unknown action." };
};

export default function MembersRoute() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <s-page heading="Members">
      {result?.message && <s-banner tone="success">{result.message}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      <s-banner tone="info">
        Only Shopify customer IDs and membership aggregates are stored. No
        customer profile data is retained.
      </s-banner>
      <s-section heading="Recent members">
        {data.members.length === 0 ? (
          <s-text>No members yet.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {data.members.map((member) => (
              <s-section key={member.id} heading={member.customerGid}>
                <s-text>
                  {member.tierName} · spend {member.netSpendMinor} · points{" "}
                  {member.pointsBalance}
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="tier" />
                  <input type="hidden" name="memberId" value={member.id} />
                  <select name="tierId" defaultValue={member.tierId ?? ""}>
                    {data.tiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} (rank {tier.rank})
                      </option>
                    ))}
                  </select>{" "}
                  <s-button type="submit">Override tier</s-button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="points" />
                  <input type="hidden" name="memberId" value={member.id} />
                  <input name="delta" type="number" step="1" required />{" "}
                  <s-button type="submit">Adjust points</s-button>
                </Form>
              </s-section>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
