import { describe, expect, it } from "vitest";
import { sovereignCreditSpreadPp } from "./sovereignCreditSpread";

describe("sovereignCreditSpreadPp", () => {
  it("uses the existing rating schedule", () => {
    expect(["AAA", "AA", "A", "BBB", "BB", "B", "CCC"].map(sovereignCreditSpreadPp)).toEqual([
      0, 0.5, 1.5, 3, 5, 8, 12,
    ]);
  });

  it("keeps missing or invalid ratings at the legacy neutral spread", () => {
    expect(sovereignCreditSpreadPp(null)).toBe(0);
    expect(sovereignCreditSpreadPp(undefined)).toBe(0);
    expect(sovereignCreditSpreadPp("unknown")).toBe(0);
    expect(sovereignCreditSpreadPp(5)).toBe(0);
  });
});
