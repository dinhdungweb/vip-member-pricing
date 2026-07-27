import { Prisma } from "../../generated/prisma/client.js";
import { findShopByDomain } from "../members/member.server";
import { withTenant } from "../shared/tenant.server";

export class RedemptionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function reserveRedemption(input: {
  shopDomain: string;
  customerGid: string;
  rewardId: string;
  idempotencyKey: string;
}) {
  const shop = await findShopByDomain(input.shopDomain);
  if (!shop) throw new RedemptionError("Shop not found", 404);

  try {
    return await withTenant(shop.id, async (transaction) => {
      const existing = await transaction.redemption.findUnique({
        where: {
          shopId_idempotencyKey: {
            shopId: shop.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return existing;

      const memberRows = await transaction.$queryRaw<
        Array<{
          id: string;
          currentTierId: string | null;
          pointsBalance: bigint;
        }>
      >`
        SELECT "id", "currentTierId", "pointsBalance"
        FROM "Member"
        WHERE "shopId" = ${shop.id}::uuid
          AND "customerGid" = ${input.customerGid}
        FOR UPDATE
      `;
      const member = memberRows[0];
      if (!member) throw new RedemptionError("Member not found", 404);

      const reward = await transaction.reward.findFirst({
        where: { id: input.rewardId, shopId: shop.id, active: true },
        include: { minimumTier: true },
      });
      if (!reward) throw new RedemptionError("Reward is unavailable", 404);
      if (member.pointsBalance < reward.pointsCost) {
        throw new RedemptionError("Not enough points", 409);
      }

      if (reward.minimumTier) {
        const currentTier = member.currentTierId
          ? await transaction.tier.findUnique({
              where: { id: member.currentTierId },
            })
          : null;
        if (!currentTier || currentTier.rank < reward.minimumTier.rank) {
          throw new RedemptionError("Current tier is not eligible", 403);
        }
      }

      const balanceAfter = member.pointsBalance - reward.pointsCost;
      const redemption = await transaction.redemption.create({
        data: {
          shopId: shop.id,
          memberId: member.id,
          rewardId: reward.id,
          pointsCost: reward.pointsCost,
          idempotencyKey: input.idempotencyKey,
        },
      });
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
          type: "REDEEM_RESERVED",
          delta: -reward.pointsCost,
          balanceAfter,
          referenceGid: redemption.id,
          idempotencyKey: `redemption-reserved:${redemption.id}`,
        },
      });
      await transaction.outboxJob.create({
        data: {
          shopId: shop.id,
          type: "ISSUE_REWARD",
          aggregateId: redemption.id,
          payload: { redemptionId: redemption.id },
        },
      });
      return redemption;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return withTenant(shop.id, (transaction) =>
        transaction.redemption.findUniqueOrThrow({
          where: {
            shopId_idempotencyKey: {
              shopId: shop.id,
              idempotencyKey: input.idempotencyKey,
            },
          },
        }),
      );
    }
    throw error;
  }
}

export async function cancelRedemption(input: {
  shopDomain: string;
  customerGid: string;
  redemptionId: string;
}) {
  const shop = await findShopByDomain(input.shopDomain);
  if (!shop) throw new RedemptionError("Shop not found", 404);

  return withTenant(shop.id, async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT r."id"
      FROM "Redemption" r
      JOIN "Member" m
        ON m."id" = r."memberId" AND m."shopId" = r."shopId"
      WHERE r."id" = ${input.redemptionId}::uuid
        AND r."shopId" = ${shop.id}::uuid
        AND m."customerGid" = ${input.customerGid}
      FOR UPDATE OF r
    `;
    const redemption = locked[0]
      ? await transaction.redemption.findUnique({
          where: { id: locked[0].id },
        })
      : null;
    if (!redemption) throw new RedemptionError("Redemption not found", 404);
    if (redemption.status === "CANCELLED") return redemption;
    if (redemption.status === "REDEEMED") {
      throw new RedemptionError("A redeemed reward cannot be cancelled", 409);
    }
    if (redemption.status === "ISSUED") {
      await transaction.outboxJob.create({
        data: {
          shopId: shop.id,
          type: "VERIFY_AND_CANCEL_REWARD",
          aggregateId: redemption.id,
          payload: { redemptionId: redemption.id },
        },
      });
      return redemption;
    }
    if (redemption.status !== "PENDING") {
      throw new RedemptionError("Redemption cannot be cancelled", 409);
    }

    const memberRows = await transaction.$queryRaw<
      Array<{ id: string; pointsBalance: bigint }>
    >`
      SELECT "id", "pointsBalance"
      FROM "Member"
      WHERE "id" = ${redemption.memberId}::uuid
        AND "shopId" = ${shop.id}::uuid
      FOR UPDATE
    `;
    const member = memberRows[0];
    if (!member) throw new RedemptionError("Member not found", 404);
    const balanceAfter = member.pointsBalance + redemption.pointsCost;

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
        type: "REDEEM_COMPENSATED",
        delta: redemption.pointsCost,
        balanceAfter,
        referenceGid: redemption.id,
        idempotencyKey: `redemption-cancelled:${redemption.id}`,
      },
    });
    return transaction.redemption.update({
      where: { id: redemption.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  });
}
