export interface TierCandidate {
  id: string;
  rank: number;
  minSpendMinor: bigint;
  discountBps: number;
}

export function selectTierForSpend<T extends TierCandidate>(
  tiers: readonly T[],
  netSpendMinor: bigint,
): T | null {
  return (
    [...tiers]
      .filter((tier) => tier.minSpendMinor <= netSpendMinor)
      .sort(
        (left, right) =>
          right.rank - left.rank ||
          Number(right.minSpendMinor - left.minSpendMinor),
      )[0] ?? null
  );
}

export function validateTierSet(tiers: readonly TierCandidate[]): string[] {
  const errors: string[] = [];
  if (tiers.length === 0) errors.push("At least one tier is required.");
  if (tiers.length > 10) errors.push("A maximum of 10 tiers is supported.");
  if (!tiers.some((tier) => tier.minSpendMinor === 0n)) {
    errors.push("The base tier must have a zero spend threshold.");
  }

  const ranks = new Set<number>();
  for (const tier of tiers) {
    if (ranks.has(tier.rank)) errors.push(`Duplicate tier rank ${tier.rank}.`);
    ranks.add(tier.rank);
    if (tier.discountBps < 0 || tier.discountBps > 10_000) {
      errors.push(`Tier ${tier.id} has an invalid discount.`);
    }
  }
  return errors;
}
