-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'UNINSTALLED', 'REDACTED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'FROZEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('EARN', 'REFUND', 'REDEEM_RESERVED', 'REDEEM_COMPENSATED', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('FIXED_DISCOUNT', 'FREE_PRODUCT');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'ISSUED', 'REDEEMED', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AccessRuleType" AS ENUM ('LOGIN_REQUIRED', 'MINIMUM_TIER');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "shopifyShopGid" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "ShopStatus" NOT NULL DEFAULT 'PENDING',
    "goLiveAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "planHandle" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "loyaltyOrdersThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "overLimitPeriods" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramConfig" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "goLiveAt" TIMESTAMP(3),
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "pointsEarnNumerator" INTEGER NOT NULL DEFAULT 1,
    "pointsSpendMinor" BIGINT NOT NULL DEFAULT 100,
    "badgePosition" TEXT NOT NULL DEFAULT 'top-left',
    "badgeBackground" TEXT NOT NULL DEFAULT '#f5f5f5',
    "badgeForeground" TEXT NOT NULL DEFAULT '#111111',
    "badgeBorderRadiusPx" INTEGER NOT NULL DEFAULT 0,
    "shopifyDiscountGid" TEXT,
    "shopifyValidationGid" TEXT,
    "customSelectors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "minSpendMinor" BIGINT NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAccessRule" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "type" "AccessRuleType" NOT NULL,
    "minimumTierRank" INTEGER,
    "includeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "collectionGids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productGids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageVi" TEXT NOT NULL DEFAULT 'Sản phẩm này chỉ dành cho thành viên đủ hạng.',
    "messageEn" TEXT NOT NULL DEFAULT 'This product requires a higher membership tier.',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAccessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "customerGid" TEXT NOT NULL,
    "currentTierId" UUID,
    "netSpendMinor" BIGINT NOT NULL DEFAULT 0,
    "pointsBalance" BIGINT NOT NULL DEFAULT 0,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "lastOrderAt" TIMESTAMP(3),
    "metafieldSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFact" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "orderGid" TEXT NOT NULL,
    "customerGid" TEXT,
    "eligiblePaidMinor" BIGINT NOT NULL DEFAULT 0,
    "refundedMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "lastSourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "type" "LedgerType" NOT NULL,
    "delta" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "referenceGid" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "minimumTierId" UUID,
    "name" TEXT NOT NULL,
    "type" "RewardType" NOT NULL,
    "pointsCost" BIGINT NOT NULL,
    "fixedAmountMinor" BIGINT,
    "freeProductVariantGid" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "pointsCost" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "shopifyDiscountGid" TEXT,
    "discountCodeEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunctionConfigVersion" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "discountConfig" JSONB NOT NULL,
    "accessConfig" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunctionConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "shopId" UUID,
    "webhookId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB,
    "sourceOccurredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" TEXT,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shopId_key" ON "Subscription"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramConfig_shopId_key" ON "ProgramConfig"("shopId");

-- CreateIndex
CREATE INDEX "Tier_shopId_minSpendMinor_idx" ON "Tier"("shopId", "minSpendMinor");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_shopId_handle_key" ON "Tier"("shopId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_shopId_rank_key" ON "Tier"("shopId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_shopId_id_key" ON "Tier"("shopId", "id");

-- CreateIndex
CREATE INDEX "ProductAccessRule_shopId_enabled_idx" ON "ProductAccessRule"("shopId", "enabled");

-- CreateIndex
CREATE INDEX "Member_shopId_currentTierId_idx" ON "Member"("shopId", "currentTierId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_shopId_customerGid_key" ON "Member"("shopId", "customerGid");

-- CreateIndex
CREATE UNIQUE INDEX "Member_shopId_id_key" ON "Member"("shopId", "id");

-- CreateIndex
CREATE INDEX "OrderFact_shopId_customerGid_paidAt_idx" ON "OrderFact"("shopId", "customerGid", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFact_shopId_orderGid_key" ON "OrderFact"("shopId", "orderGid");

-- CreateIndex
CREATE INDEX "PointsLedger_shopId_memberId_occurredAt_idx" ON "PointsLedger"("shopId", "memberId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedger_shopId_idempotencyKey_key" ON "PointsLedger"("shopId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Reward_shopId_active_idx" ON "Reward"("shopId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_shopId_id_key" ON "Reward"("shopId", "id");

-- CreateIndex
CREATE INDEX "Redemption_shopId_memberId_createdAt_idx" ON "Redemption"("shopId", "memberId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_shopId_idempotencyKey_key" ON "Redemption"("shopId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FunctionConfigVersion_shopId_version_key" ON "FunctionConfigVersion"("shopId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_webhookId_key" ON "WebhookEvent"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopDomain_status_receivedAt_idx" ON "WebhookEvent"("shopDomain", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "OutboxJob_status_availableAt_idx" ON "OutboxJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxJob_shopId_aggregateId_idx" ON "OutboxJob"("shopId", "aggregateId");

-- CreateIndex
CREATE INDEX "SyncRun_shopId_startedAt_idx" ON "SyncRun"("shopId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramConfig" ADD CONSTRAINT "ProgramConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccessRule" ADD CONSTRAINT "ProductAccessRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_shopId_currentTierId_fkey" FOREIGN KEY ("shopId", "currentTierId") REFERENCES "Tier"("shopId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFact" ADD CONSTRAINT "OrderFact_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_shopId_memberId_fkey" FOREIGN KEY ("shopId", "memberId") REFERENCES "Member"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_shopId_minimumTierId_fkey" FOREIGN KEY ("shopId", "minimumTierId") REFERENCES "Tier"("shopId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_shopId_memberId_fkey" FOREIGN KEY ("shopId", "memberId") REFERENCES "Member"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_shopId_rewardId_fkey" FOREIGN KEY ("shopId", "rewardId") REFERENCES "Reward"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunctionConfigVersion" ADD CONSTRAINT "FunctionConfigVersion_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation. The runtime connection must set app.current_shop_id inside
-- each transaction. The migration/maintenance role owns the tables and is kept
-- separate from the runtime role.
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Subscription"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "ProgramConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProgramConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ProgramConfig"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "Tier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tier" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Tier"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "ProductAccessRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductAccessRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ProductAccessRule"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Member"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "OrderFact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderFact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "OrderFact"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "PointsLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PointsLedger" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PointsLedger"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "Reward" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reward" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Reward"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "Redemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Redemption" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Redemption"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "FunctionConfigVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FunctionConfigVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FunctionConfigVersion"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "OutboxJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "OutboxJob"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "SyncRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SyncRun"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AuditLog"
  USING ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK ("shopId" = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
