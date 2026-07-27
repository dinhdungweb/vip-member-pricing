import type { Prisma } from "../../generated/prisma/client.js";
import db from "../../db.server";
import { enqueueWebhook } from "./queue.server";

export interface IngestWebhookInput {
  webhookId: string;
  topic: string;
  shopDomain: string;
  payload: unknown;
}

export async function ingestWebhook(input: IngestWebhookInput) {
  const shop = await db.shop.findUnique({ where: { domain: input.shopDomain } });
  const event = await db.webhookEvent.upsert({
    where: { webhookId: input.webhookId },
    update: {},
    create: {
      webhookId: input.webhookId,
      topic: input.topic,
      shopDomain: input.shopDomain,
      shopId: shop?.id,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });

  if (event.status === "RECEIVED") {
    await enqueueWebhook(event.id);
  }
  return event;
}
