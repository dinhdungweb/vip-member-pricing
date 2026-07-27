import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  customerGid,
  shopDomainFromDest,
} from "../modules/members/member.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } =
    await authenticate.public.customerAccount(request);
  const domain = shopDomainFromDest(sessionToken.dest);
  const shop = await db.shop.findUnique({ where: { domain } });
  if (!shop) return cors(Response.json({ error: "Shop not found" }, { status: 404 }));
  const rows = await withTenant(shop.id, async (tx) => {
    const member = await tx.member.findUnique({
      where: {
        shopId_customerGid: {
          shopId: shop.id,
          customerGid: customerGid(sessionToken.sub),
        },
      },
    });
    if (!member) return [];
    return tx.pointsLedger.findMany({
      where: { shopId: shop.id, memberId: member.id },
      orderBy: { occurredAt: "desc" },
      take: 100,
    });
  });
  return cors(
    Response.json({
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        delta: row.delta.toString(),
        balanceAfter: row.balanceAfter.toString(),
        occurredAt: row.occurredAt.toISOString(),
      })),
    }),
  );
};
