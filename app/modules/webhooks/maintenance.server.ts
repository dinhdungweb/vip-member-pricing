import db from "../../db.server";
import { Prisma } from "../../generated/prisma/client.js";
import { unauthenticated } from "../../shopify.server";
import { withTenant } from "../shared/tenant.server";

export async function runRetentionMaintenance(): Promise<void> {
  const webhookCutoff = new Date(
    Date.now() -
      Number(process.env.WEBHOOK_PAYLOAD_RETENTION_DAYS ?? 30) * 86_400_000,
  );
  await db.webhookEvent.updateMany({
    where: {
      receivedAt: { lt: webhookCutoff },
    },
    data: { payload: Prisma.DbNull },
  });

  const auditCutoff = new Date(
    Date.now() -
      Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 365) * 86_400_000,
  );
  const shops = await db.shop.findMany({ select: { id: true } });
  for (const shop of shops) {
    await withTenant(shop.id, async (transaction) => {
      await transaction.auditLog.deleteMany({
        where: { shopId: shop.id, createdAt: { lt: auditCutoff } },
      });
      await transaction.outboxJob.updateMany({
        where: {
          shopId: shop.id,
          status: "PROCESSING",
          lockedAt: { lt: new Date(Date.now() - 10 * 60_000) },
        },
        data: {
          status: "PENDING",
          lockedAt: null,
          availableAt: new Date(),
          lastError: "Recovered stale worker lock",
        },
      });
      await transaction.redemption.updateMany({
        where: {
          shopId: shop.id,
          status: "ISSUED",
          expiresAt: { lt: new Date() },
        },
        data: { status: "EXPIRED" },
      });
    });
  }
}

export async function runNightlyReconciliation(): Promise<void> {
  const shops = await db.shop.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, domain: true },
  });
  const updatedAfter = new Date(Date.now() - 48 * 60 * 60_000);
  for (const shop of shops) {
    const syncRun = await withTenant(shop.id, (transaction) =>
      transaction.syncRun.create({
        data: {
          shopId: shop.id,
          type: "ORDER_RECONCILIATION",
          status: "RUNNING",
        },
      }),
    );
    try {
      const { admin } = await unauthenticated.admin(shop.domain);
      const response = await admin.graphql(
        `#graphql
          query ReconcileVipOrders($query: String!, $after: String) {
            orders(first: 100, after: $after, query: $query) {
              nodes { id updatedAt }
              pageInfo { hasNextPage endCursor }
            }
          }`,
        {
          variables: {
            query: `updated_at:>='${updatedAfter.toISOString()}'`,
            after: null,
          },
        },
      );
      const body = (await response.json()) as {
        errors?: Array<{ message: string }>;
        data?: {
          orders?: {
            nodes: Array<{ id: string; updatedAt: string }>;
            pageInfo: { hasNextPage: boolean; endCursor?: string | null };
          };
        };
      };
      if (body.errors?.length) {
        throw new Error(body.errors.map((error) => error.message).join("; "));
      }
      const orders = body.data?.orders?.nodes ?? [];
      const known = await withTenant(shop.id, (transaction) =>
        transaction.orderFact.findMany({
          where: {
            shopId: shop.id,
            orderGid: { in: orders.map((order) => order.id) },
          },
          select: { orderGid: true, lastSourceUpdatedAt: true },
        }),
      );
      const facts = new Map(
        known.map((fact) => [fact.orderGid, fact.lastSourceUpdatedAt]),
      );
      const discrepancies = orders.filter((order) => {
        const fact = facts.get(order.id);
        return !fact || fact < new Date(order.updatedAt);
      });
      await withTenant(shop.id, (transaction) =>
        transaction.syncRun.update({
          where: { id: syncRun.id },
          data: {
            status: discrepancies.length ? "NEEDS_REVIEW" : "COMPLETED",
            processed: orders.length,
            failed: discrepancies.length,
            cursor: body.data?.orders?.pageInfo.endCursor ?? null,
            completedAt: new Date(),
            error: discrepancies.length
              ? `${discrepancies.length} orders require webhook replay`
              : null,
          },
        }),
      );
    } catch (error) {
      await withTenant(shop.id, (transaction) =>
        transaction.syncRun.update({
          where: { id: syncRun.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: (
              error instanceof Error ? error.message : String(error)
            ).slice(0, 2_000),
          },
        }),
      );
    }
  }
}
