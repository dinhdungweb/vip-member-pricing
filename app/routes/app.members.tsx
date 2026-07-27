import { randomUUID } from "node:crypto";
import { useMemo, useState } from "react";
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
  const [query, setQuery] = useState("");
  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data.members;
    return data.members.filter(
      (member) =>
        member.customerGid.toLowerCase().includes(normalized) ||
        member.tierName.toLowerCase().includes(normalized),
    );
  }, [data.members, query]);
  const totalPoints = data.members.reduce(
    (sum, member) => sum + BigInt(member.pointsBalance),
    0n,
  );

  return (
    <main className="app-page">
      <PageHeader
        eyebrow="Customer management"
        title="Members"
        description="Review tiers and point balances, then make audited manual adjustments."
      />

      {result?.message && <Alert tone="success">{result.message}</Alert>}
      {result?.error && <Alert tone="danger">{result.error}</Alert>}
      <Alert tone="info">
        The app stores only Shopify customer IDs and membership aggregates. No
        customer profile data is retained.
      </Alert>

      <section className="metrics-grid" aria-label="Member metrics">
        <Metric
          label="Recent members"
          value={String(data.members.length)}
          help="Up to 100 records"
        />
        <Metric
          label="Total available points"
          value={totalPoints.toLocaleString("en-US")}
        />
        <Metric label="Tier count" value={String(data.tiers.length)} />
        <Metric
          label="Visible results"
          value={String(visibleMembers.length)}
          help={query ? "Filter applied" : "No filter"}
        />
      </section>

      <Card>
        <SectionHeader
          title="Member list"
          description="Override a tier or add and subtract points for an individual member."
          action={
            <label className="search-field">
              <span className="sr-only">Search members</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search by ID or tier..."
              />
            </label>
          }
        />

        {data.members.length === 0 ? (
          <EmptyState
            title="No members yet"
            description="Members appear after a customer qualifies or places an eligible order."
          />
        ) : visibleMembers.length === 0 ? (
          <EmptyState
            title="No matching members"
            description="Try searching with part of the customer ID or tier name."
          />
        ) : (
          <div className="item-list">
            {visibleMembers.map((member) => (
              <article className="member-card" key={member.id}>
                <div className="member-card__head">
                  <div>
                    <h3>{member.customerGid}</h3>
                    <p>Internal ID: {member.id}</p>
                  </div>
                  <StatusBadge tone={member.tierId ? "info" : "neutral"}>
                    {member.tierName}
                  </StatusBadge>
                </div>

                <div className="member-stats">
                  <div>
                    <span>Net spend</span>
                    <strong className="numeric">
                      {Number(member.netSpendMinor).toLocaleString("en-US")}
                    </strong>
                  </div>
                  <div>
                    <span>Available points</span>
                    <strong className="numeric">
                      {BigInt(member.pointsBalance).toLocaleString("en-US")}
                    </strong>
                  </div>
                </div>

                <div className="member-actions">
                  <Form method="post" className="inline-form">
                    <input type="hidden" name="intent" value="tier" />
                    <input type="hidden" name="memberId" value={member.id} />
                    <label className="field">
                      <span>Tier override</span>
                      <select name="tierId" defaultValue={member.tierId ?? ""}>
                        {data.tiers.map((tier) => (
                          <option key={tier.id} value={tier.id}>
                            {tier.name} · rank {tier.rank}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="button button--small" type="submit">
                      Update tier
                    </button>
                  </Form>
                  <Form method="post" className="inline-form">
                    <input type="hidden" name="intent" value="points" />
                    <input type="hidden" name="memberId" value={member.id} />
                    <label className="field">
                      <span>Point adjustment</span>
                      <input
                        name="delta"
                        type="number"
                        step="1"
                        placeholder="+100 or -50"
                        required
                      />
                    </label>
                    <button className="button button--small" type="submit">
                      Apply
                    </button>
                  </Form>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
