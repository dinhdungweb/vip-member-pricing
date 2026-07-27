import { Worker } from "bullmq";
import db from "../app/db.server";
import maintenanceDb from "../app/maintenance-db.server";
import {
  dispatchPendingOutbox,
  processOutboxJob,
} from "../app/modules/webhooks/outbox.server";
import { processWebhookEvent } from "../app/modules/webhooks/process.server";
import { redisConnection } from "../app/modules/webhooks/queue.server";
import {
  runNightlyReconciliation,
  runRetentionMaintenance,
} from "../app/modules/webhooks/maintenance.server";

const worker = new Worker<{ eventId: string }>(
  "shopify-webhooks",
  async (job) => processWebhookEvent(job.data.eventId),
  {
    connection: redisConnection(),
    concurrency: Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? 10),
  },
);

const outboxWorker = new Worker<{ shopId: string; outboxId: string }>(
  "vip-pricing-outbox",
  async (job) => processOutboxJob(job.data.shopId, job.data.outboxId),
  {
    connection: redisConnection(),
    concurrency: Number(process.env.OUTBOX_WORKER_CONCURRENCY ?? 5),
  },
);

const outboxPoller = setInterval(
  () => {
    void dispatchPendingOutbox().catch((error) => {
      console.error("Could not dispatch outbox", error);
    });
  },
  Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 5_000),
);
outboxPoller.unref();
void dispatchPendingOutbox();

const maintenancePoller = setInterval(() => {
  void runRetentionMaintenance().catch((error) => {
    console.error("Retention maintenance failed", error);
  });
}, 60 * 60_000);
maintenancePoller.unref();

const reconciliationPoller = setInterval(() => {
  void runNightlyReconciliation().catch((error) => {
    console.error("Nightly reconciliation failed", error);
  });
}, 24 * 60 * 60_000);
reconciliationPoller.unref();

worker.on("failed", (job, error) => {
  console.error("Webhook job failed", {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: error.message,
  });
});

async function shutdown(signal: string) {
  console.info(`Worker received ${signal}; shutting down`);
  clearInterval(outboxPoller);
  clearInterval(maintenancePoller);
  clearInterval(reconciliationPoller);
  await Promise.all([worker.close(), outboxWorker.close()]);
  await Promise.all([db.$disconnect(), maintenanceDb.$disconnect()]);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.info("VIP Member Pricing webhook worker started");
