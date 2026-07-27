import { Queue } from "bullmq";

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };
}

let queue: Queue | undefined;
let outbox: Queue | undefined;

export function webhookQueue(): Queue {
  queue ??= new Queue("shopify-webhooks", {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return queue;
}

export async function enqueueWebhook(eventId: string): Promise<void> {
  await webhookQueue().add(
    "process",
    { eventId },
    {
      jobId: eventId,
    },
  );
}

export function outboxQueue(): Queue {
  outbox ??= new Queue("vip-pricing-outbox", {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return outbox;
}

export async function enqueueOutbox(
  shopId: string,
  outboxId: string,
): Promise<void> {
  await outboxQueue().add(
    "process",
    { shopId, outboxId },
    { jobId: outboxId },
  );
}

export { redisConnection };
