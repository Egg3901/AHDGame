import { describe, expect, it } from "vitest";
import { formatBankMoney, formatRatePercent } from "./formatBankMoney";

describe("formatBankMoney", () => {
  it("formats compact millions", () => {
    expect(formatBankMoney(2_500_000, "USD")).toBe("$2.50M");
  });

  it("formats JPY without decimals", () => {
    expect(formatBankMoney(1234, "JPY")).toBe("¥1,234");
  });
});

describe("formatRatePercent", () => {
  it("formats two decimal places", () => {
    expect(formatRatePercent(3.5)).toBe("3.50%");
  });

  it("returns dash for non-finite", () => {
    expect(formatRatePercent(Number.NaN)).toBe("-");
  });
});
