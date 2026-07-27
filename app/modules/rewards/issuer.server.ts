import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { unauthenticated } from "../../shopify.server";
import {
  deterministicRewardCode,
  encryptSecret,
} from "../shared/encryption.server";
import { minorToDecimal } from "../shared/money";
import { withTenant } from "../shared/tenant.server";

type UserError = { message: string; code?: string };

function messages(errors: UserError[] | undefined): string {
  return errors?.map((error) => error.message).join("; ") ?? "";
}

async function findDiscountByCode(
  admin: AdminApiContext,
  code: string,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      query FindRewardDiscount($query: String!) {
        codeDiscountNodes(first: 1, query: $query) {
          nodes { id }
        }
      }`,
    { variables: { query: `code:${code}` } },
  );
  const body = (await response.json()) as {
    data?: { codeDiscountNodes?: { nodes?: Array<{ id: string }> } };
  };
  return body.data?.codeDiscountNodes?.nodes?.[0]?.id ?? null;
}

async function createFixedDiscount(
  admin: AdminApiContext,
  input: {
    code: string;
    title: string;
    customerGid: string;
    amount: string;
    startsAt: string;
    endsAt: string;
  },
): Promise<string> {
  const response = await admin.graphql(
    `#graphql
      mutation IssueFixedReward($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) {
          codeDiscountNode { id }
          userErrors { code message field }
        }
      }`,
    {
      variables: {
        input: {
          title: input.title,
          code: input.code,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          context: { customers: { add: [input.customerGid] } },
          customerGets: {
            value: {
              discountAmount: {
                amount: input.amount,
                appliesOnEachItem: false,
              },
            },
            items: { all: true },
          },
          combinesWith: {
            productDiscounts: true,
            orderDiscounts: true,
            shippingDiscounts: true,
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
          tags: ["vip-member-pricing", "reward"],
        },
      },
    },
  );
  const body = (await response.json()) as {
    data?: {
      discountCodeBasicCreate?: {
        codeDiscountNode?: { id?: string };
        userErrors?: UserError[];
      };
    };
  };
  const payload = body.data?.discountCodeBasicCreate;
  if (!payload?.codeDiscountNode?.id) {
    throw new Error(messages(payload?.userErrors) || "Could not issue reward");
  }
  return payload.codeDiscountNode.id;
}

async function createFreeProductDiscount(
  admin: AdminApiContext,
  input: {
    code: string;
    title: string;
    customerGid: string;
    variantGid: string;
    startsAt: string;
    endsAt: string;
  },
): Promise<string> {
  const response = await admin.graphql(
    `#graphql
      mutation IssueFreeProductReward($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) {
          codeDiscountNode { id }
          userErrors { code message field }
        }
      }`,
    {
      variables: {
        input: {
          title: input.title,
          code: input.code,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          context: { customers: { add: [input.customerGid] } },
          customerGets: {
            value: { percentage: 1.0 },
            items: {
              products: { productVariantsToAdd: [input.variantGid] },
            },
          },
          combinesWith: {
            productDiscounts: true,
            orderDiscounts: true,
            shippingDiscounts: true,
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
          tags: ["vip-member-pricing", "reward"],
        },
      },
    },
  );
  const body = (await response.json()) as {
    data?: {
      discountCodeBasicCreate?: {
        codeDiscountNode?: { id?: string };
        userErrors?: UserError[];
      };
    };
  };
  const payload = body.data?.discountCodeBasicCreate;
  if (!payload?.codeDiscountNode?.id) {
    throw new Error(messages(payload?.userErrors) || "Could not issue reward");
  }
  return payload.codeDiscountNode.id;
}

export async function issueReward(
  shopId: string,
  redemptionId: string,
): Promise<void> {
  const redemption = await withTenant(shopId, (transaction) =>
    transaction.redemption.findFirst({
      where: { id: redemptionId, shopId },
      include: {
        member: true,
        reward: true,
        shop: true,
      },
    }),
  );
  if (!redemption || redemption.status !== "PENDING") return;

  const code = deterministicRewardCode(redemption.id);
  const startsAt = new Date();
  const endsAt = new Date(
    startsAt.getTime() + redemption.reward.validityDays * 86_400_000,
  );
  const { admin } = await unauthenticated.admin(redemption.shop.domain);
  let discountGid = await findDiscountByCode(admin, code);

  if (!discountGid && redemption.reward.type === "FIXED_DISCOUNT") {
    if (
      redemption.reward.fixedAmountMinor === null ||
      redemption.reward.fixedAmountMinor <= 0n
    ) {
      throw new Error("Fixed discount reward has no valid amount");
    }
    discountGid = await createFixedDiscount(admin, {
      code,
      title: `VIP reward - ${redemption.reward.name}`,
      customerGid: redemption.member.customerGid,
      amount: minorToDecimal(
        redemption.reward.fixedAmountMinor,
        redemption.shop.currencyCode,
      ),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
  }

  if (!discountGid && redemption.reward.type === "FREE_PRODUCT") {
    if (!redemption.reward.freeProductVariantGid) {
      throw new Error("Free product reward has no product variant");
    }
    discountGid = await createFreeProductDiscount(admin, {
      code,
      title: `VIP reward - ${redemption.reward.name}`,
      customerGid: redemption.member.customerGid,
      variantGid: redemption.reward.freeProductVariantGid,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
  }

  if (!discountGid) throw new Error("Unsupported reward type");

  await withTenant(shopId, (transaction) =>
    transaction.redemption.updateMany({
      where: { id: redemption.id, shopId, status: "PENDING" },
      data: {
        status: "ISSUED",
        shopifyDiscountGid: discountGid,
        discountCodeEncrypted: encryptSecret(code),
        issuedAt: startsAt,
        expiresAt: endsAt,
        failureReason: null,
      },
    }),
  );
}

export async function failRewardIssuance(
  shopId: string,
  redemptionId: string,
  reason: string,
): Promise<void> {
  await withTenant(shopId, async (transaction) => {
    const redemptions = await transaction.$queryRaw<
      Array<{ id: string; memberId: string; pointsCost: bigint }>
    >`
      SELECT "id", "memberId", "pointsCost"
      FROM "Redemption"
      WHERE "id" = ${redemptionId}::uuid
        AND "shopId" = ${shopId}::uuid
        AND "status" = 'PENDING'
      FOR UPDATE
    `;
    const redemption = redemptions[0];
    if (!redemption) return;

    const members = await transaction.$queryRaw<
      Array<{ id: string; pointsBalance: bigint }>
    >`
      SELECT "id", "pointsBalance"
      FROM "Member"
      WHERE "id" = ${redemption.memberId}::uuid
        AND "shopId" = ${shopId}::uuid
      FOR UPDATE
    `;
    const member = members[0];
    if (!member) throw new Error("Member not found for reward compensation");
    const balanceAfter = member.pointsBalance + redemption.pointsCost;
    await transaction.member.update({
      where: { id: member.id },
      data: {
        pointsBalance: balanceAfter,
        stateVersion: { increment: 1 },
      },
    });
    await transaction.pointsLedger.createMany({
      data: [
        {
          shopId,
          memberId: member.id,
          type: "REDEEM_COMPENSATED",
          delta: redemption.pointsCost,
          balanceAfter,
          referenceGid: redemption.id,
          idempotencyKey: `redemption-failed:${redemption.id}`,
          metadata: { reason: reason.slice(0, 500) },
        },
      ],
      skipDuplicates: true,
    });
    await transaction.redemption.update({
      where: { id: redemption.id },
      data: {
        status: "FAILED",
        failureReason: reason.slice(0, 2_000),
      },
    });
  });
}

export async function verifyAndCancelReward(
  shopId: string,
  redemptionId: string,
): Promise<void> {
  const redemption = await withTenant(shopId, (transaction) =>
    transaction.redemption.findFirst({
      where: { id: redemptionId, shopId },
      include: { shop: true },
    }),
  );
  if (
    !redemption ||
    redemption.status !== "ISSUED" ||
    !redemption.shopifyDiscountGid
  ) {
    return;
  }

  const { admin } = await unauthenticated.admin(redemption.shop.domain);
  const usageResponse = await admin.graphql(
    `#graphql
      query RewardUsage($id: ID!) {
        codeDiscountNode(id: $id) {
          codeDiscount {
            ... on DiscountCodeBasic { asyncUsageCount }
            ... on DiscountCodeBxgy { asyncUsageCount }
          }
        }
      }`,
    { variables: { id: redemption.shopifyDiscountGid } },
  );
  const usageBody = (await usageResponse.json()) as {
    data?: {
      codeDiscountNode?: {
        codeDiscount?: { asyncUsageCount?: number };
      } | null;
    };
  };
  const usageCount =
    usageBody.data?.codeDiscountNode?.codeDiscount?.asyncUsageCount ?? 0;
  if (usageCount > 0) {
    await withTenant(shopId, (transaction) =>
      transaction.redemption.update({
        where: { id: redemption.id },
        data: { status: "REDEEMED", redeemedAt: new Date() },
      }),
    );
    return;
  }

  const deleteResponse = await admin.graphql(
    `#graphql
      mutation DeleteUnusedReward($id: ID!) {
        discountCodeDelete(id: $id) {
          deletedCodeDiscountId
          userErrors { code message field }
        }
      }`,
    { variables: { id: redemption.shopifyDiscountGid } },
  );
  const deleteBody = (await deleteResponse.json()) as {
    data?: {
      discountCodeDelete?: {
        deletedCodeDiscountId?: string;
        userErrors?: UserError[];
      };
    };
  };
  const deleteResult = deleteBody.data?.discountCodeDelete;
  if (!deleteResult?.deletedCodeDiscountId) {
    throw new Error(
      messages(deleteResult?.userErrors) || "Could not cancel reward",
    );
  }

  await withTenant(shopId, async (transaction) => {
    const redemptions = await transaction.$queryRaw<
      Array<{ id: string; memberId: string; pointsCost: bigint }>
    >`
      SELECT "id", "memberId", "pointsCost"
      FROM "Redemption"
      WHERE "id" = ${redemption.id}::uuid
        AND "shopId" = ${shopId}::uuid
        AND "status" = 'ISSUED'
      FOR UPDATE
    `;
    const current = redemptions[0];
    if (!current) return;
    const members = await transaction.$queryRaw<
      Array<{ id: string; pointsBalance: bigint }>
    >`
      SELECT "id", "pointsBalance"
      FROM "Member"
      WHERE "id" = ${current.memberId}::uuid
        AND "shopId" = ${shopId}::uuid
      FOR UPDATE
    `;
    const member = members[0];
    if (!member) throw new Error("Member not found for reward cancellation");
    const balanceAfter = member.pointsBalance + current.pointsCost;
    await transaction.member.update({
      where: { id: member.id },
      data: {
        pointsBalance: balanceAfter,
        stateVersion: { increment: 1 },
      },
    });
    await transaction.pointsLedger.createMany({
      data: [
        {
          shopId,
          memberId: member.id,
          type: "REDEEM_COMPENSATED",
          delta: current.pointsCost,
          balanceAfter,
          referenceGid: current.id,
          idempotencyKey: `redemption-cancelled:${current.id}`,
        },
      ],
      skipDuplicates: true,
    });
    await transaction.redemption.update({
      where: { id: current.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  });
}
