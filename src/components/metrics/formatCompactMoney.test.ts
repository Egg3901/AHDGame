import { describe, it, expect } from "vitest";
import { formatCompactMoney } from "./formatCompactMoney";

describe("formatCompactMoney", () => {
  it("formats trillions with two decimals", () => {
    expect(formatCompactMoney("£", 2_700_000_000_000)).toBe("£2.70T");
    expect(formatCompactMoney("¥", 126_000_000_000_000)).toBe("¥126.00T");
  });

  it("formats billions, millions, thousands", () => {
    expect(formatCompactMoney("$", 5_000_000_000)).toBe("$5.00B");
    expect(formatCompactMoney("$", 3_200_000)).toBe("$3.2M");
    expect(formatCompactMoney("$", 72_463.77)).toBe("$72.5K");
  });

  it("formats small amounts with no suffix", () => {
    expect(formatCompactMoney("€", 500)).toBe("€500");
  });

  it("handles negative values", () => {
    expect(formatCompactMoney("$", -2_000_000_000)).toBe("-$2.00B");
  });
});
