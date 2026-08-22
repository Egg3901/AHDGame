import { describe, expect, it } from "vitest";
import { effectiveBorrowingLimit } from "./borrowingLimit";

describe("effectiveBorrowingLimit", () => {
  it("gives East Germany real deficit-spending room instead of its frozen 1953 nominal cap", () => {
    expect(
      effectiveBorrowingLimit({
        countryId: "DD",
        gdp: 50_000_000_000,
        storedCeiling: 10_000_000_000,
      })
    ).toBe(20_000_000_000);
  });

  it("never lowers a legislated or otherwise higher stored limit", () => {
    expect(
      effectiveBorrowingLimit({
        countryId: "DD",
        gdp: 50_000_000_000,
        storedCeiling: 25_000_000_000,
      })
    ).toBe(25_000_000_000);
  });

  it("does not rewrite other countries' statutory limits", () => {
    expect(
      effectiveBorrowingLimit({
        countryId: "US",
        gdp: 500_000_000_000,
        storedCeiling: 290_000_000_000,
      })
    ).toBe(290_000_000_000);
  });
});
