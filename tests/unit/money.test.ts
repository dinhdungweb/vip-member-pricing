import { describe, expect, it } from "vitest";
import {
  currencyDecimals,
  decimalToMinor,
  minorToDecimal,
} from "../../app/modules/shared/money";

describe("currency minor units", () => {
  it("handles zero-decimal currencies such as VND", () => {
    expect(currencyDecimals("VND")).toBe(0);
    expect(decimalToMinor("333700", "VND")).toBe(333700n);
    expect(minorToDecimal(333700n, "VND")).toBe("333700");
  });

  it("handles two and three decimal currencies without floating point", () => {
    expect(decimalToMinor("19.99", "USD")).toBe(1999n);
    expect(minorToDecimal(1999n, "USD")).toBe("19.99");
    expect(decimalToMinor("1.234", "KWD")).toBe(1234n);
    expect(minorToDecimal(-1234n, "KWD")).toBe("-1.234");
  });
});
