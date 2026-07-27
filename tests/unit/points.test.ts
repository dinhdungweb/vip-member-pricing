import { describe, expect, it } from "vitest";
import { calculateEarnedPoints } from "../../app/modules/points/points";

describe("points earning", () => {
  it("supports VND-style earn units without floating point", () => {
    expect(
      calculateEarnedPoints(333_700n, {
        pointsEarnNumerator: 1,
        pointsSpendMinor: 1_000n,
      }),
    ).toBe(333n);
  });
});
