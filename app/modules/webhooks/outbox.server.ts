import maintenanceDb from "../../maintenance-db.server";
import { unauthenticated } from "../../shopify.server";
import { publishFunctionConfigVersion } from "../pricing/function-config.server";
import {
  failRewardIssuance,
  issueReward,
  verifyAndCancelReward,
} from "../rewards/issuer.server";
import { CONTRACT_SCHEMA_VERSION } from "../shared/constants";
import { withTenant } from "../shared/tenant.server";
import { enqueueOutbox } from "./queue.server";

const MAX_ATTEMPTS = 8;

function payloadString(payload: unknown, key: string, fallback = ""): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : fallback;
}

export async function dispatchPendingOutbox(limit = 100): Promise<number> {
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  await maintenanceDb.outboxJob.updateMany({
    where: {
      status: "PROCESSING",
      lockedAt: { lt: staleBefore },
    },
    data: {
      status: "PENDING",
      lockedAt: null,
      availableAt: new Date(),
      lastError: "Recovered stale worker lock",
    },
  });

  const jobs = await maintenanceDb.outboxJob.findMany({
    where: {
      status: "PENDING",
      availableAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, shopId: true },
  });
  await Promise.all(jobs.map((job) => enqueueOutbox(job.shopId, job.id)));
  return jobs.length;
}

async function syncMemberMetafield(
  shopId: string,
  memberId: string,
): Promise<void> {
  const member = await withTenant(shopId, (transaction) =>
    transaction.member.findFirst({
      where: { id: memberId, shopId },
      include: {
        currentTier: true,
        shop: { include: { programConfig: true } },
      },
    }),
  );
  if (!member?.currentTier || !member.shop.programConfig) {
    throw new Error(`Member ${memberId} is missing tier or program config`);
  }

  const value = JSON.stringify({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    configVersion: member.shop.programConfig.configVersion,
    enabled: member.shop.programConfig.enabled,
    tierHandle: member.currentTier.handle,
    tierRank: member.currentTier.rank,
    discountBps: member.currentTier.discountBps,
    pointsBalance: member.pointsBalance.toString(),
  });
  const { admin } = await unauthenticated.admin(member.shop.domain);
  const response = await admin.graphql(
    `#graphql
      mutation SetMemberState($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: member.customerGid,
            namespace: "$app:vip_pricing",
            key: "member_state",
            type: "json",
            value,
          },
        ],
      },
    },
  );
  const result = (await response.json()) as {
    data?: {
      metafieldsSet?: {
        userErrors?: Array<{ message: string }>;
      };
    };
  };
  const errors = result.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
  await withTenant(shopId, (transaction) =>
    transaction.member.update({
      where: { id: member.id },
      data: { metafieldSyncedAt: new Date() },
    }),
  );
}

async function recordCustomerDataExport(
  shopId: string,
  customerGid: string,
): Promise<void> {
  await withTenant(shopId, async (transaction) => {
    const [member, orders, ledger] = await Promise.all([
      transaction.member.findUnique({
        where: { shopId_customerGid: { shopId, customerGid } },
      }),
      transaction.orderFact.count({ where: { shopId, customerGid } }),
      transaction.pointsLedger.count({
        where: {
          shopId,
          member: { customerGid },
        },
      }),
    ]);
    await transaction.syncRun.create({
      data: {
        shopId,
        type: "CUSTOMER_DATA_EXPORT",
        status: "COMPLETED",
        processed: Number(Boolean(member)) + orders + ledger,
        completedAt: new Date(),
      },
    });
    await transaction.auditLog.create({
      data: {
        shopId,
        actorType: "SHOPIFY_COMPLIANCE",
        action: "CUSTOMER_DATA_EXPORT_PREPARED",
        aggregateType: "Customer",
        after: {
          memberRecordCount: Number(Boolean(member)),
          orderFactCount: orders,
          ledgerEntryCount: ledger,
        },
      },
    });
  });
}

async function handleJob(input: {
  shopId: string;
  type: string;
  aggregateId: string;
  payload: unknown;
}) {
  switch (input.type) {
    case "SYNC_MEMBER_METAFIELD":
      await syncMemberMetafield(
        input.shopId,
        payloadString(input.payload, "memberId", input.aggregateId),
      );
      return;
    case "PUBLISH_FUNCTION_CONFIG":
      await publishFunctionConfigVersion(
        input.shopId,
        payloadString(
          input.payload,
          "functionConfigVersionId",
          input.aggregateId,
        ),
      );
      return;
    case "ISSUE_REWARD":
      await issueReward(
        input.shopId,
        payloadString(input.payload, "redemptionId", input.aggregateId),
      );
      return;
    case "VERIFY_AND_CANCEL_REWARD":
      await verifyAndCancelReward(
        input.shopId,
        payloadString(input.payload, "redemptionId", input.aggregateId),
      );
      return;
    case "CUSTOMER_DATA_EXPORT":
      await recordCustomerDataExport(
        input.shopId,
        payloadString(input.payload, "customerGid", input.aggregateId),
      );
      return;
    default:
      throw new Error(`Unsupported outbox type: ${input.type}`);
  }
}

export async function processOutboxJob(
  shopId: string,
  outboxId: string,
): Promise<void> {
  const job = await withTenant(shopId, async (transaction) => {
    const current = await transaction.outboxJob.findFirst({
      where: { id: outboxId, shopId },
    });
    if (!current || current.status === "COMPLETED") return null;
    return transaction.outboxJob.update({
      where: { id: current.id },
      data: {
        status: "PROCESSING",
        lockedAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
  });
  if (!job) return;

  try {
    await handleJob(job);
    await withTenant(shopId, (transaction) =>
      transaction.outboxJob.update({
        where: { id: outboxId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          lockedAt: null,
        },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    if (exhausted && job.type === "ISSUE_REWARD") {
      await failRewardIssuance(
        shopId,
        payloadString(job.payload, "redemptionId", job.aggregateId),
        message,
      );
    }
    await withTenant(shopId, (transaction) =>
      transaction.outboxJob.update({
        where: { id: outboxId },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          availableAt: new Date(
            Date.now() + Math.min(15 * 60_000, 2 ** job.attempts * 1_000),
          ),
          lockedAt: null,
          lastError: message.slice(0, 2_000),
        },
      }),
    );
    if (!exhausted) throw error;
  }
}
