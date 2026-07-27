import db from "../../db.server";
import { calculateEarnedPoints } from "../points/points";
import { decimalToMinor } from "../shared/money";
import { withTenant } from "../shared/tenant.server";
import { selectTierForSpend } from "../tiers/tier";

type TenantTransaction = Parameters<Parameters<typeof withTenant>[1]>[0];
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  const date = new Date(stringValue(value));
  return Number.isNaN(date.valueOf()) ? fallback : date;
}

function gid(resource: "Order" | "Customer", value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  return raw.startsWith("gid://") ? raw : `gid://shopify/${resource}/${raw}`;
}

function lineItems(payload: JsonObject): JsonObject[] {
  return Array.isArray(payload.line_items)
    ? payload.line_items.map(object)
    : [];
}

function eligibleOrderMinor(payload: JsonObject, currency: string): bigint {
  const items = lineItems(payload);
  if (items.length === 0) {
    return decimalToMinor(
      stringValue(
        payload.current_subtotal_price ?? payload.subtotal_price,
        "0",
      ),
      currency,
    );
  }

  return items.reduce((total, item) => {
    if (item.gift_card === true) return total;
    const quantity = BigInt(
      Math.max(0, Number(item.current_quantity ?? item.quantity ?? 0)),
    );
    const gross =
      decimalToMinor(stringValue(item.price, "0"), currency) * quantity;
    const allocations = Array.isArray(item.discount_allocations)
      ? item.discount_allocations.map(object)
      : [];
    const discount =
      allocations.length > 0
        ? allocations.reduce(
            (sum, allocation) =>
              sum +
              decimalToMinor(stringValue(allocation.amount, "0"), currency),
            0n,
          )
        : decimalToMinor(stringValue(item.total_discount, "0"), currency);
    return total + (gross > discount ? gross - discount : 0n);
  }, 0n);
}

function refundedMerchandiseMinor(
  payload: JsonObject,
  currency: string,
): bigint {
  const refundLines = Array.isArray(payload.refund_line_items)
    ? payload.refund_line_items.map(object)
    : [];

  return refundLines.reduce((total, refundLine) => {
    const item = object(refundLine.line_item);
    if (item.gift_card === true) return total;
    const amount = object(refundLine.subtotal_set);
    const shopMoney = object(amount.shop_money);
    const decimal = stringValue(
      shopMoney.amount ?? refundLine.subtotal,
      "0",
    );
    return total + decimalToMinor(decimal, currency);
  }, 0n);
}

async function createMemberIfMissing(
  transaction: TenantTransaction,
  shopId: string,
  customerGid: string,
) {
  await transaction.member.upsert({
    where: { shopId_customerGid: { shopId, customerGid } },
    update: {},
    create: { shopId, customerGid },
  });
  const rows = await transaction.$queryRaw<
    Array<{
      id: string;
      currentTierId: string | null;
      netSpendMinor: bigint;
      pointsBalance: bigint;
    }>
  >`
    SELECT "id", "currentTierId", "netSpendMinor", "pointsBalance"
    FROM "Member"
    WHERE "shopId" = ${shopId}::uuid AND "customerGid" = ${customerGid}
    FOR UPDATE
  `;
  if (!rows[0]) throw new Error("Unable to lock member");
  return rows[0];
}

async function applyMemberDelta(
  transaction: TenantTransaction,
  input: {
    shopId: string;
    customerGid: string;
    spendDelta: bigint;
    pointsDelta: bigint;
    referenceGid: string;
    idempotencyKey: string;
    occurredAt: Date;
    allowUpgrade: boolean;
  },
) {
  const member = await createMemberIfMissing(
    transaction,
    input.shopId,
    input.customerGid,
  );
  const netSpendMinor =
    member.netSpendMinor + input.spendDelta > 0n
      ? member.netSpendMinor + input.spendDelta
      : 0n;
  const requestedBalance = member.pointsBalance + input.pointsDelta;
  const pointsBalance = requestedBalance > 0n ? requestedBalance : 0n;
  const appliedPointsDelta = pointsBalance - member.pointsBalance;

  const tiers = await transaction.tier.findMany({
    where: { shopId: input.shopId },
    orderBy: { rank: "asc" },
  });
  const currentTier = tiers.find((tier) => tier.id === member.currentTierId);
  const earnedTier = selectTierForSpend(tiers, netSpendMinor);
  const nextTierId =
    input.allowUpgrade &&
    earnedTier &&
    (!currentTier || earnedTier.rank > currentTier.rank)
      ? earnedTier.id
      : member.currentTierId;

  await transaction.member.update({
    where: { id: member.id },
    data: {
      netSpendMinor,
      pointsBalance,
      currentTierId: nextTierId,
      lastOrderAt:
        input.spendDelta > 0n ? input.occurredAt : undefined,
      stateVersion: { increment: 1 },
    },
  });

  await transaction.pointsLedger.create({
    data: {
      shopId: input.shopId,
      memberId: member.id,
      type: input.spendDelta < 0n ? "REFUND" : "EARN",
      delta: appliedPointsDelta,
      balanceAfter: pointsBalance,
      referenceGid: input.referenceGid,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
    },
  });

  await transaction.outboxJob.create({
    data: {
      shopId: input.shopId,
      type: "SYNC_MEMBER_METAFIELD",
      aggregateId: member.id,
      payload: {
        memberId: member.id,
        customerGid: input.customerGid,
      },
    },
  });
}

async function processOrderPaid(
  transaction: TenantTransaction,
  shopId: string,
  payload: JsonObject,
) {
  const orderGid = gid(
    "Order",
    payload.admin_graphql_api_id ?? payload.id,
  );
  if (!orderGid) throw new Error("orders/paid is missing order id");

  const currency = stringValue(
    payload.current_currency ?? payload.currency,
  ).toUpperCase();
  if (!currency) throw new Error("orders/paid is missing currency");

  const paidAt = dateValue(
    payload.processed_at ?? payload.updated_at ?? payload.created_at,
  );
  const customer = object(payload.customer);
  const customerGid = gid(
    "Customer",
    customer.admin_graphql_api_id ?? customer.id,
  );
  const eligiblePaidMinor = eligibleOrderMinor(payload, currency);

  const inserted = await transaction.orderFact.createMany({
    data: [
      {
        shopId,
        orderGid,
        customerGid,
        eligiblePaidMinor,
        currencyCode: currency,
        paidAt,
        lastSourceUpdatedAt: dateValue(payload.updated_at, paidAt),
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0 || !customerGid) return;

  const config = await transaction.programConfig.findUnique({
    where: { shopId },
  });
  const shop = await transaction.shop.findUnique({
    where: { id: shopId },
    select: { goLiveAt: true },
  });
  if (
    !config?.enabled ||
    !shop?.goLiveAt ||
    paidAt < shop.goLiveAt
  ) {
    return;
  }

  const points = calculateEarnedPoints(eligiblePaidMinor, config);
  await applyMemberDelta(transaction, {
    shopId,
    customerGid,
    spendDelta: eligiblePaidMinor,
    pointsDelta: points,
    referenceGid: orderGid,
    idempotencyKey: `order-paid:${orderGid}`,
    occurredAt: paidAt,
    allowUpgrade: true,
  });
  await transaction.subscription.updateMany({
    where: { shopId, status: "ACTIVE" },
    data: { loyaltyOrdersThisPeriod: { increment: 1 } },
  });
}

async function processRefund(
  transaction: TenantTransaction,
  shopId: string,
  payload: JsonObject,
) {
  const orderGid = gid(
    "Order",
    payload.order_admin_graphql_api_id ?? payload.order_id,
  );
  if (!orderGid) throw new Error("refunds/create is missing order id");
  const refundId =
    stringValue(payload.admin_graphql_api_id) || stringValue(payload.id);
  if (!refundId) throw new Error("refunds/create is missing refund id");
  const refundGid = refundId.startsWith("gid://")
    ? refundId
    : `gid://shopify/Refund/${refundId}`;
  const order = await transaction.orderFact.findUnique({
    where: { shopId_orderGid: { shopId, orderGid } },
  });
  if (!order) {
    throw new Error(`Order fact ${orderGid} is not available yet`);
  }
  if (!order.customerGid) return;

  const requested = refundedMerchandiseMinor(payload, order.currencyCode);
  const remaining = order.eligiblePaidMinor - order.refundedMinor;
  const refundMinor =
    requested > remaining ? remaining : requested > 0n ? requested : 0n;
  if (refundMinor === 0n) return;

  const config = await transaction.programConfig.findUnique({
    where: { shopId },
  });
  if (!config) return;
  const points = calculateEarnedPoints(refundMinor, config);

  await transaction.orderFact.update({
    where: { id: order.id },
    data: {
      refundedMinor: { increment: refundMinor },
      lastSourceUpdatedAt: dateValue(payload.created_at),
    },
  });
  await applyMemberDelta(transaction, {
    shopId,
    customerGid: order.customerGid,
    spendDelta: -refundMinor,
    pointsDelta: -points,
    referenceGid: refundGid,
    idempotencyKey: `refund:${refundGid}`,
    occurredAt: dateValue(payload.created_at),
    allowUpgrade: false,
  });
}

async function processCancelled(
  transaction: TenantTransaction,
  shopId: string,
  payload: JsonObject,
) {
  const orderGid = gid(
    "Order",
    payload.admin_graphql_api_id ?? payload.id,
  );
  if (!orderGid) return;
  const updated = await transaction.orderFact.updateMany({
    where: { shopId, orderGid },
    data: {
      cancelledAt: dateValue(payload.cancelled_at),
      lastSourceUpdatedAt: dateValue(payload.updated_at),
    },
  });
  if (updated.count === 0) {
    throw new Error(`Order fact ${orderGid} is not available yet`);
  }
}

async function processCustomerDataRequest(
  transaction: TenantTransaction,
  shopId: string,
  payload: JsonObject,
) {
  const requestedCustomerGid = gid("Customer", object(payload.customer).id);
  if (!requestedCustomerGid) return;
  await transaction.outboxJob.create({
    data: {
      shopId,
      type: "CUSTOMER_DATA_EXPORT",
      aggregateId: requestedCustomerGid,
      payload: { customerGid: requestedCustomerGid },
    },
  });
}

async function processCustomerRedact(
  transaction: TenantTransaction,
  shopId: string,
  payload: JsonObject,
) {
  const requestedCustomerGid = gid("Customer", object(payload.customer).id);
  if (!requestedCustomerGid) return;
  await transaction.orderFact.updateMany({
    where: { shopId, customerGid: requestedCustomerGid },
    data: { customerGid: null },
  });
  await transaction.member.deleteMany({
    where: { shopId, customerGid: requestedCustomerGid },
  });
  await transaction.auditLog.create({
    data: {
      shopId,
      actorType: "SHOPIFY_COMPLIANCE",
      action: "CUSTOMER_REDACTED",
      aggregateType: "Customer",
    },
  });
}

function normalizeTopic(topic: string): string {
  const known: Record<string, string> = {
    ORDERS_PAID: "orders/paid",
    REFUNDS_CREATE: "refunds/create",
    ORDERS_CANCELLED: "orders/cancelled",
    APP_UNINSTALLED: "app/uninstalled",
    CUSTOMERS_DATA_REQUEST: "customers/data_request",
    CUSTOMERS_REDACT: "customers/redact",
    SHOP_REDACT: "shop/redact",
  };
  return known[topic.toUpperCase()] ?? topic.toLowerCase();
}

export async function processWebhookEvent(eventId: string): Promise<void> {
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === "PROCESSED") return;

  await db.webhookEvent.update({
    where: { id: event.id },
    data: { status: "PROCESSING", attempts: { increment: 1 }, error: null },
  });

  try {
    const shop =
      event.shopId
        ? await db.shop.findUnique({ where: { id: event.shopId } })
        : await db.shop.findUnique({ where: { domain: event.shopDomain } });
    if (!shop) throw new Error(`Unknown shop ${event.shopDomain}`);
    const payload = object(event.payload);
    const topic = normalizeTopic(event.topic);

    if (topic === "shop/redact") {
      await db.session.deleteMany({ where: { shop: shop.domain } });
      await db.shop.delete({ where: { id: shop.id } });
    } else {
      await withTenant(shop.id, async (transaction) => {
        if (topic === "orders/paid") {
          await processOrderPaid(transaction, shop.id, payload);
        } else if (topic === "refunds/create") {
          await processRefund(transaction, shop.id, payload);
        } else if (topic === "orders/cancelled") {
          await processCancelled(transaction, shop.id, payload);
        } else if (topic === "customers/data_request") {
          await processCustomerDataRequest(transaction, shop.id, payload);
        } else if (topic === "customers/redact") {
          await processCustomerRedact(transaction, shop.id, payload);
        } else if (topic === "app/uninstalled") {
          await transaction.programConfig.updateMany({
            where: { shopId: shop.id },
            data: { enabled: false },
          });
        }
      });
      if (topic === "app/uninstalled") {
        await db.shop.update({
          where: { id: shop.id },
          data: { status: "UNINSTALLED", uninstalledAt: new Date() },
        });
        await db.session.deleteMany({ where: { shop: shop.domain } });
      }
    }

    await db.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (error) {
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message.slice(0, 2_000) : "Error",
      },
    });
    throw error;
  }
}
