import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ingestWebhook } from "../modules/webhooks/ingest.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId =
    request.headers.get("X-Shopify-Webhook-Id") ?? crypto.randomUUID();
  const { payload, topic, shop } = await authenticate.webhook(request);
  await ingestWebhook({ webhookId, topic, shopDomain: shop, payload });
  return new Response(null, { status: 200 });
};
