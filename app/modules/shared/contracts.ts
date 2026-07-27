import { z } from "zod";
import { CONTRACT_SCHEMA_VERSION } from "./constants";

export const memberStateSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  configVersion: z.number().int().positive(),
  enabled: z.boolean(),
  tierHandle: z.string().min(1),
  tierRank: z.number().int().nonnegative(),
  discountBps: z.number().int().min(0).max(10_000),
  pointsBalance: z.string().regex(/^\d+$/),
});

export type MemberState = z.infer<typeof memberStateSchema>;

export const discountConfigSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  configVersion: z.number().int().positive(),
  enabled: z.boolean(),
  combinesWith: z.object({
    productDiscounts: z.literal(false),
    orderDiscounts: z.boolean(),
    shippingDiscounts: z.literal(true),
  }),
});

export type DiscountConfig = z.infer<typeof discountConfigSchema>;
