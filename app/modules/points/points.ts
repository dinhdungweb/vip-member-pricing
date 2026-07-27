export interface PointsRule {
  pointsEarnNumerator: number;
  pointsSpendMinor: bigint;
}

export function calculateEarnedPoints(
  eligiblePaidMinor: bigint,
  rule: PointsRule,
): bigint {
  if (eligiblePaidMinor <= 0n) return 0n;
  if (
    !Number.isInteger(rule.pointsEarnNumerator) ||
    rule.pointsEarnNumerator <= 0
  ) {
    throw new RangeError("pointsEarnNumerator must be a positive integer");
  }
  if (rule.pointsSpendMinor <= 0n) {
    throw new RangeError("pointsSpendMinor must be positive");
  }
  return (
    (eligiblePaidMinor * BigInt(rule.pointsEarnNumerator)) /
    rule.pointsSpendMinor
  );
}
