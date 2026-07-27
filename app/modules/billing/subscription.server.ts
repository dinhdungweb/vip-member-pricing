import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { withTenant } from "../shared/tenant.server";

export const PLAN_LIMITS: Record<string, number> = {
  starter: 500,
  growth: 2_500,
  pro: 10_000,
  development: Number.MAX_SAFE_INTEGER,
};

function planHandle(name: string): string {
  const value = name.toLowerCase();
  if (value.includes("pro")) return "pro";
  if (value.includes("growth")) return "growth";
  if (value.includes("starter")) return "starter";
  return value.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function syncManagedPricingSubscription(
  shopId: string,
  admin: AdminApiContext,
) {
  const response = await admin.graphql(
    `#graphql
      query VipPricingEntitlement {
        shop { plan { partnerDevelopment } }
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            createdAt
            currentPeriodEnd
            trialDays
          }
        }
      }`,
  );
  const body = (await response.json()) as {
    errors?: Array<{ message: string }>;
    data?: {
      shop?: { plan?: { partnerDevelopment?: boolean } };
      currentAppInstallation?: {
        activeSubscriptions?: Array<{
          name: string;
          status: string;
          createdAt: string;
          currentPeriodEnd?: string | null;
        }>;
      };
    };
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  const development = body.data?.shop?.plan?.partnerDevelopment === true;
  const active = body.data?.currentAppInstallation?.activeSubscriptions?.[0];
  const handle = development
    ? "development"
    : active
      ? planHandle(active.name)
      : null;

  return withTenant(shopId, async (transaction) => {
    if (!handle) {
      const existing = await transaction.subscription.findUnique({
        where: { shopId },
      });
      if (!existing) return null;
      return transaction.subscription.update({
        where: { shopId },
        data: { status: "CANCELLED" },
      });
    }
    const currentPeriodStart = active?.createdAt
      ? new Date(active.createdAt)
      : new Date();
    const currentPeriodEnd = active?.currentPeriodEnd
      ? new Date(active.currentPeriodEnd)
      : null;
    const existing = await transaction.subscription.findUnique({
      where: { shopId },
    });
    const periodChanged =
      existing?.currentPeriodEnd?.toISOString() !==
      currentPeriodEnd?.toISOString();
    const previousLimit = existing
      ? (PLAN_LIMITS[existing.planHandle] ?? 0)
      : 0;
    const nextOverLimitPeriods =
      existing && periodChanged
        ? existing.loyaltyOrdersThisPeriod > previousLimit
          ? existing.overLimitPeriods + 1
          : 0
        : existing?.overLimitPeriods;
    return transaction.subscription.upsert({
      where: { shopId },
      create: {
        shopId,
        planHandle: handle,
        status: development ? "ACTIVE" : "ACTIVE",
        currentPeriodStart,
        currentPeriodEnd,
      },
      update: {
        planHandle: handle,
        status: "ACTIVE",
        currentPeriodStart,
        currentPeriodEnd,
        ...(periodChanged
          ? {
              loyaltyOrdersThisPeriod: 0,
              overLimitPeriods: nextOverLimitPeriods ?? 0,
            }
          : {}),
      },
    });
  });
}

export function subscriptionCanEdit(input: {
  planHandle: string;
  status: string;
  loyaltyOrdersThisPeriod: number;
  overLimitPeriods: number;
} | null): boolean {
  if (!input || input.status !== "ACTIVE") return false;
  const limit = PLAN_LIMITS[input.planHandle] ?? 0;
  return (
    input.loyaltyOrdersThisPeriod <= limit || input.overLimitPeriods < 2
  );
}
