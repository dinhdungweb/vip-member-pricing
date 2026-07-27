import db from "../../db.server";
import { withTenant } from "../shared/tenant.server";

export async function ensureShop(shopDomain: string) {
  const shop = await db.shop.upsert({
    where: { domain: shopDomain },
    update: {
      status: "ACTIVE",
      uninstalledAt: null,
    },
    create: {
      domain: shopDomain,
      status: "PENDING",
    },
  });

  return withTenant(shop.id, async (transaction) => {
    await transaction.programConfig.upsert({
      where: { shopId: shop.id },
      update: {},
      create: { shopId: shop.id },
    });
    await transaction.tier.upsert({
      where: {
        shopId_handle: { shopId: shop.id, handle: "member" },
      },
      update: {},
      create: {
        shopId: shop.id,
        handle: "member",
        name: "Member",
        rank: 0,
        minSpendMinor: 0n,
        discountBps: 0,
      },
    });
    return transaction.shop.findUniqueOrThrow({
      where: { id: shop.id },
      include: {
        programConfig: true,
        subscription: true,
        tiers: { orderBy: { rank: "asc" } },
      },
    });
  });
}
