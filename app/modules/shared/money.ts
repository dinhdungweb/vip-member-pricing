const CURRENCY_DECIMALS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

export function currencyDecimals(currencyCode: string): number {
  return CURRENCY_DECIMALS[currencyCode.toUpperCase()] ?? 2;
}

export function decimalToMinor(
  amount: string | number,
  currencyCode: string,
): bigint {
  const decimals = currencyDecimals(currencyCode);
  const normalized = String(amount).trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  const result =
    BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");

  return negative ? -result : result;
}

export function minorToDecimal(
  amountMinor: bigint,
  currencyCode: string,
): string {
  const decimals = currencyDecimals(currencyCode);
  if (decimals === 0) return amountMinor.toString();

  const negative = amountMinor < 0;
  const absolute = negative ? -amountMinor : amountMinor;
  const factor = 10n ** BigInt(decimals);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
