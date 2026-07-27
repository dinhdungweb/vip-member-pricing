export interface MemberPriceInput {
  currentPriceMinor: bigint;
  compareAtPriceMinor?: bigint | null;
  memberDiscountBps: number;
}

export interface MemberPriceResult {
  originalPriceMinor: bigint;
  currentPriceMinor: bigint;
  memberDiscountMinor: bigint;
  finalPriceMinor: bigint;
  catalogDiscountBps: number;
  combinedDiscountBps: number;
  hasCatalogSale: boolean;
}

const BASIS_POINTS = 10_000n;

function toBps(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * BASIS_POINTS + denominator / 2n) / denominator);
}

export function calculateMemberPrice(
  input: MemberPriceInput,
): MemberPriceResult {
  if (input.currentPriceMinor < 0n) {
    throw new RangeError("currentPriceMinor must be non-negative");
  }
  if (
    !Number.isInteger(input.memberDiscountBps) ||
    input.memberDiscountBps < 0 ||
    input.memberDiscountBps > 10_000
  ) {
    throw new RangeError("memberDiscountBps must be an integer from 0 to 10000");
  }

  const compareAt = input.compareAtPriceMinor ?? 0n;
  const hasCatalogSale =
    compareAt > 0n && compareAt > input.currentPriceMinor;
  const originalPriceMinor = hasCatalogSale
    ? compareAt
    : input.currentPriceMinor;
  const discountBaseMinor = originalPriceMinor;
  const requestedMemberDiscount =
    (discountBaseMinor * BigInt(input.memberDiscountBps)) / BASIS_POINTS;
  const memberDiscountMinor =
    requestedMemberDiscount > input.currentPriceMinor
      ? input.currentPriceMinor
      : requestedMemberDiscount;
  const finalPriceMinor = input.currentPriceMinor - memberDiscountMinor;
  const catalogDiscountBps = hasCatalogSale
    ? toBps(compareAt - input.currentPriceMinor, compareAt)
    : 0;
  const combinedDiscountBps =
    originalPriceMinor > 0n
      ? toBps(originalPriceMinor - finalPriceMinor, originalPriceMinor)
      : 0;

  return {
    originalPriceMinor,
    currentPriceMinor: input.currentPriceMinor,
    memberDiscountMinor,
    finalPriceMinor,
    catalogDiscountBps,
    combinedDiscountBps,
    hasCatalogSale,
  };
}

export function formatDiscountBadge(
  discountBps: number,
  member: boolean,
): string {
  const percentage = discountBps / 100;
  const formatted = Number.isInteger(percentage)
    ? percentage.toFixed(0)
    : percentage.toFixed(1);
  return `-${formatted}%${member ? " MEMBER" : ""}`;
}
