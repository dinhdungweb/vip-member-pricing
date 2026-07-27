import { describe, expect, it } from "vitest";
import {
  calculateMemberPrice,
  formatDiscountBadge,
} from "../../app/modules/pricing/pricing";

describe("calculateMemberPrice", () => {
  it("adds catalog sale and member percentage from original price", () => {
    const result = calculateMemberPrice({
      currentPriceMinor: 900_000n,
      compareAtPriceMinor: 1_000_000n,
      memberDiscountBps: 600,
    });

    expect(result.memberDiscountMinor).toBe(60_000n);
    expect(result.finalPriceMinor).toBe(840_000n);
    expect(result.catalogDiscountBps).toBe(1000);
    expect(result.combinedDiscountBps).toBe(1600);
    expect(formatDiscountBadge(result.combinedDiscountBps, true)).toBe(
      "-16% MEMBER",
    );
  });

  it("applies member percentage to current price without compare-at sale", () => {
    const result = calculateMemberPrice({
      currentPriceMinor: 1_000_000n,
      memberDiscountBps: 600,
    });

    expect(result.finalPriceMinor).toBe(940_000n);
    expect(result.combinedDiscountBps).toBe(600);
  });

  it("caps the member discount at the remaining line price", () => {
    const result = calculateMemberPrice({
      currentPriceMinor: 100n,
      compareAtPriceMinor: 1000n,
      memberDiscountBps: 5000,
    });

    expect(result.memberDiscountMinor).toBe(100n);
    expect(result.finalPriceMinor).toBe(0n);
    expect(result.combinedDiscountBps).toBe(10_000);
  });
});
