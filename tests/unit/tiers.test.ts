import { describe, expect, it } from "vitest";
import {
  selectTierForSpend,
  validateTierSet,
} from "../../app/modules/tiers/tier";

const tiers = [
  { id: "member", rank: 0, minSpendMinor: 0n, discountBps: 0 },
  { id: "silver", rank: 1, minSpendMinor: 5_000_000n, discountBps: 300 },
  { id: "gold", rank: 2, minSpendMinor: 10_000_000n, discountBps: 600 },
];

describe("tier selection", () => {
  it("selects the highest reached tier", () => {
    expect(selectTierForSpend(tiers, 12_000_000n)?.id).toBe("gold");
  });

  it("requires a zero-threshold base tier", () => {
    expect(validateTierSet(tiers)).toEqual([]);
    expect(validateTierSet(tiers.slice(1))).toContain(
      "The base tier must have a zero spend threshold.",
    );
  });
});
