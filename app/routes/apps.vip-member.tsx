import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  customerGid,
  getMemberSnapshot,
  publicMemberJson,
} from "../modules/members/member.server";
import { decryptSecret } from "../modules/shared/encryption.server";
import {
  RedemptionError,
  reserveRedemption,
} from "../modules/rewards/redemption.server";
import { withTenant } from "../modules/shared/tenant.server";
import { authenticate } from "../shopify.server";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { liquid, session } = await authenticate.public.appProxy(request);
  if (!session) return liquid("App is not available.", { status: 401 });
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) {
    return liquid("Please sign in before redeeming a reward.", { status: 401 });
  }
  const formData = await request.formData();
  const rewardId = String(formData.get("rewardId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  if (!rewardId || !idempotencyKey) {
    return liquid("Invalid reward request.", { status: 400 });
  }
  try {
    await reserveRedemption({
      shopDomain: session.shop,
      customerGid: customerId,
      rewardId,
      idempotencyKey,
    });
    return new Response(null, {
      status: 303,
      headers: { Location: "/apps/vip-member" },
    });
  } catch (error) {
    if (error instanceof RedemptionError) {
      return liquid(escapeHtml(error.message), { status: error.status });
    }
    throw error;
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid, session } = await authenticate.public.appProxy(request);
  if (!session) return liquid("App is not available.", { status: 401 });
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  const snapshot = publicMemberJson(
    await getMemberSnapshot(session.shop, customerId),
  );
  if (!customerId) {
    return liquid(
      `<section class="vip-member-page"><h1>VIP Member</h1><p>Please <a href="/account/login">sign in</a> to view your tier and points.</p></section>`,
    );
  }
  if (!snapshot?.tier) {
    return liquid(
      `<section class="vip-member-page"><h1>VIP Member</h1><p>Your membership will appear after your first eligible paid order.</p></section>`,
    );
  }

  const nextTier = snapshot.nextTier
    ? `<p>Spend ${escapeHtml(snapshot.nextTier.remainingSpendMinor)} more to reach ${escapeHtml(snapshot.nextTier.name)}.</p>`
    : "<p>You have reached the highest tier.</p>";
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const details = shop
    ? await withTenant(shop.id, async (transaction) => {
        const member = await transaction.member.findUnique({
          where: {
            shopId_customerGid: {
              shopId: shop.id,
              customerGid: customerGid(customerId),
            },
          },
        });
        if (!member) return { ledger: [], rewards: [], redemptions: [] };
        const [ledger, rewards, redemptions] = await Promise.all([
          transaction.pointsLedger.findMany({
            where: { shopId: shop.id, memberId: member.id },
            orderBy: { occurredAt: "desc" },
            take: 20,
          }),
          transaction.reward.findMany({
            where: { shopId: shop.id, active: true },
            orderBy: { pointsCost: "asc" },
            take: 20,
          }),
          transaction.redemption.findMany({
            where: { shopId: shop.id, memberId: member.id },
            include: { reward: true },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        ]);
        return { ledger, rewards, redemptions };
      })
    : { ledger: [], rewards: [], redemptions: [] };
  const ledgerHtml =
    details.ledger.length > 0
      ? `<ul>${details.ledger
          .map(
            (entry) =>
              `<li>${escapeHtml(entry.type)}: ${escapeHtml(entry.delta.toString())} — ${escapeHtml(entry.occurredAt.toLocaleDateString())}</li>`,
          )
          .join("")}</ul>`
      : "<p>No points activity yet.</p>";
  const rewardsHtml =
    details.rewards.length > 0
      ? `<ul>${details.rewards
          .map((reward) => {
            const idempotencyKey = crypto.randomUUID();
            return `<li>${escapeHtml(reward.name)} — ${escapeHtml(
              reward.pointsCost.toString(),
            )} points
              <form method="post" action="/apps/vip-member">
                <input type="hidden" name="rewardId" value="${escapeHtml(reward.id)}">
                <input type="hidden" name="idempotencyKey" value="${idempotencyKey}">
                <button type="submit">Redeem</button>
              </form>
            </li>`;
          })
          .join("")}</ul>`
      : "<p>No rewards available.</p>";
  const issuedHtml =
    details.redemptions.length > 0
      ? `<ul>${details.redemptions
          .map((redemption) => {
            const code =
              redemption.status === "ISSUED" &&
              redemption.discountCodeEncrypted
                ? ` — code <strong>${escapeHtml(
                    decryptSecret(redemption.discountCodeEncrypted),
                  )}</strong>`
                : "";
            return `<li>${escapeHtml(redemption.reward.name)}: ${escapeHtml(redemption.status)}${code}</li>`;
          })
          .join("")}</ul>`
      : "<p>No issued rewards yet.</p>";
  return liquid(`<section class="vip-member-page">
    <h1>VIP Member</h1>
    <dl>
      <dt>Tier</dt><dd>${escapeHtml(snapshot.tier.name)}</dd>
      <dt>Member discount</dt><dd>${snapshot.tier.discountBps / 100}%</dd>
      <dt>Points</dt><dd>${escapeHtml(snapshot.pointsBalance)}</dd>
    </dl>
    ${nextTier}
    <h2>Points history</h2>
    ${ledgerHtml}
    <h2>Rewards</h2>
    ${rewardsHtml}
    <h2>Issued rewards</h2>
    ${issuedHtml}
  </section>`);
};
