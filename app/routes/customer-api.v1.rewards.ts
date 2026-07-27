import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  customerGid,
  shopDomainFromDest,
} from "../modules/members/member.server";
import { decryptSecret } from "../modules/shared/encryption.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } =
    await authenticate.public.customerAccount(request);
  const shop = await db.shop.findUnique({
    where: { domain: shopDomainFromDest(sessionToken.dest) },
  });
  if (!shop) return cors(Response.json({ error: "Shop not found" }, { status: 404 }));
  const { member, rewards, redemptions } = await withTenant(shop.id, async (tx) => {
    const member = await tx.member.findUnique({
      where: {
        shopId_customerGid: {
          shopId: shop.id,
          customerGid: customerGid(sessionToken.sub),
        },
      },
      include: { currentTier: { select: { rank: true } } },
    });
    const [rewards, redemptions] = await Promise.all([
      tx.reward.findMany({
        where: { shopId: shop.id, active: true },
        include: { minimumTier: { select: { rank: true } } },
        orderBy: { pointsCost: "asc" },
      }),
      member
        ? tx.redemption.findMany({
            where: { shopId: shop.id, memberId: member.id },
            include: { reward: { select: { name: true, type: true } } },
            orderBy: { createdAt: "desc" },
            take: 50,
          })
        : Promise.resolve([]),
    ]);
    return { member, rewards, redemptions };
  });
  return cors(
    Response.json({
      items: rewards.map((reward) => ({
        id: reward.id,
        name: reward.name,
        type: reward.type,
        pointsCost: reward.pointsCost.toString(),
        fixedAmountMinor: reward.fixedAmountMinor?.toString() ?? null,
        freeProductVariantGid: reward.freeProductVariantGid,
        validityDays: reward.validityDays,
        affordable:
          Boolean(member) && member!.pointsBalance >= reward.pointsCost,
        tierEligible:
          !reward.minimumTier ||
          (member?.currentTier?.rank ?? -1) >= reward.minimumTier.rank,
      })),
      issued: redemptions.map((redemption) => ({
        id: redemption.id,
        name: redemption.reward.name,
        type: redemption.reward.type,
        status: redemption.status,
        code:
          redemption.status === "ISSUED" &&
          redemption.discountCodeEncrypted
            ? decryptSecret(redemption.discountCodeEncrypted)
            : null,
        issuedAt: redemption.issuedAt?.toISOString() ?? null,
        expiresAt: redemption.expiresAt?.toISOString() ?? null,
      })),
    }),
  );
};
