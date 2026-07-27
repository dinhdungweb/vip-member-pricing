import db from "../../db.server";
import { withTenant } from "../shared/tenant.server";

export function customerGid(customerId: string): string {
  return customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;
}

export function shopDomainFromDest(dest: string): string {
  try {
    return new URL(dest).hostname;
  } catch {
    return dest.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

export function findShopByDomain(shopDomain: string) {
  return db.shop.findUnique({
    where: { domain: shopDomainFromDest(shopDomain) },
  });
}

export async function getMemberSnapshot(
  shopDomain: string,
  identity?: string | null,
) {
  const shop = await db.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return null;

  return withTenant(shop.id, async (tx) => {
    const [programConfig, tiers] = await Promise.all([
      tx.programConfig.findUnique({ where: { shopId: shop.id } }),
      tx.tier.findMany({
        where: { shopId: shop.id },
        orderBy: { rank: "asc" },
      }),
    ]);
    const badge = {
      position: programConfig?.badgePosition ?? "top-left",
      background: programConfig?.badgeBackground ?? "#f5f5f5",
      foreground: programConfig?.badgeForeground ?? "#111111",
      borderRadiusPx: programConfig?.badgeBorderRadiusPx ?? 0,
    };
    if (!identity) {
      return {
        shopId: shop.id,
        enabled: programConfig?.enabled ?? false,
        configVersion: programConfig?.configVersion ?? 1,
        badge,
        authenticated: false,
        member: null,
        nextTier: tiers[0] ?? null,
      };
    }

    const member = await tx.member.findUnique({
      where: {
        shopId_customerGid: {
          shopId: shop.id,
          customerGid: customerGid(identity),
        },
      },
      include: { currentTier: true },
    });
    const currentRank = member?.currentTier?.rank ?? -1;
    const nextTier =
      tiers.find((tier) => tier.rank > currentRank) ?? null;
    return {
      shopId: shop.id,
      enabled: programConfig?.enabled ?? false,
      configVersion: programConfig?.configVersion ?? 1,
      badge,
      authenticated: true,
      member,
      nextTier,
    };
  });
}

export function publicMemberJson(
  snapshot: Awaited<ReturnType<typeof getMemberSnapshot>>,
) {
  if (!snapshot) return null;
  const { member, nextTier } = snapshot;
  return {
    enabled: snapshot.enabled,
    configVersion: snapshot.configVersion,
    badge: snapshot.badge,
    authenticated: snapshot.authenticated,
    tier: member?.currentTier
      ? {
          handle: member.currentTier.handle,
          name: member.currentTier.name,
          rank: member.currentTier.rank,
          discountBps: member.currentTier.discountBps,
        }
      : null,
    netSpendMinor: member?.netSpendMinor.toString() ?? "0",
    pointsBalance: member?.pointsBalance.toString() ?? "0",
    nextTier: nextTier
      ? {
          name: nextTier.name,
          minSpendMinor: nextTier.minSpendMinor.toString(),
          remainingSpendMinor: (
            nextTier.minSpendMinor - (member?.netSpendMinor ?? 0n)
          ).toString(),
        }
      : null,
  };
}
