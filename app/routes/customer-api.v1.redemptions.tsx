import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticateCustomer } from "../modules/members/customer-auth.server";
import { customerGid } from "../modules/members/member.server";
import {
  RedemptionError,
  reserveRedemption,
} from "../modules/rewards/redemption.server";
import { decryptSecret } from "../modules/shared/encryption.server";
import { withTenant } from "../modules/shared/tenant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shopDomain, customerId, cors } = await authenticateCustomer(request);
  const shop = await db.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    return cors(Response.json({ error: "Shop not found" }, { status: 404 }));
  }
  const rows = await withTenant(shop.id, async (transaction) => {
    const member = await transaction.member.findUnique({
      where: {
        shopId_customerGid: {
          shopId: shop.id,
          customerGid: customerGid(customerId),
        },
      },
    });
    if (!member) return [];
    return transaction.redemption.findMany({
      where: { shopId: shop.id, memberId: member.id },
      include: { reward: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
  return cors(
    Response.json({
      items: rows.map((row) => ({
        id: row.id,
        rewardName: row.reward.name,
        status: row.status,
        code:
          row.status === "ISSUED" && row.discountCodeEncrypted
            ? decryptSecret(row.discountCodeEncrypted)
            : null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    }),
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shopDomain, customerId, cors } = await authenticateCustomer(request);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return cors(
      Response.json(
        { error: "A valid Idempotency-Key header is required" },
        { status: 400 },
      ),
    );
  }

  const body = (await request.json()) as { rewardId?: unknown };
  if (typeof body.rewardId !== "string") {
    return cors(
      Response.json({ error: "rewardId is required" }, { status: 400 }),
    );
  }

  try {
    const redemption = await reserveRedemption({
      shopDomain,
      customerGid: customerId,
      rewardId: body.rewardId,
      idempotencyKey,
    });
    return cors(
      Response.json(
        { id: redemption.id, status: redemption.status },
        { status: redemption.status === "PENDING" ? 202 : 200 },
      ),
    );
  } catch (error) {
    if (error instanceof RedemptionError) {
      return cors(
        Response.json({ error: error.message }, { status: error.status }),
      );
    }
    throw error;
  }
};
