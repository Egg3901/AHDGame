import { describe, expect, it } from "vitest";
import { isRubleAdopted, RU_2027_RUB_PER_USD, RU_2027_USD_PER_RUB } from "./rubleTransition";

describe("ruble transition rules", () => {
  it("adopts RUB for RU only in the 2027-default preset", () => {
    expect(isRubleAdopted("RU", "2027-default")).toBe(true);
    expect(isRubleAdopted("RU", "1991-default")).toBe(false);
    expect(isRubleAdopted("RU", "1979-default")).toBe(false);
    expect(isRubleAdopted("RU", "1953-default")).toBe(false);
    expect(isRubleAdopted("RU", "2019-default")).toBe(false);
    expect(isRubleAdopted("RU", "")).toBe(false);
  });

  it("never adopts RUB for any other country", () => {
    for (const countryId of ["US", "DE", "FR", "UA", "BY", "BAL"]) {
      expect(isRubleAdopted(countryId, "2027-default")).toBe(false);
    }
  });

  it("anchors the 2027 seed rate to the authored RU usdExchangeRate", () => {
    // 1 / 0.01081 = 92.506...; the seed table rounds to one decimal.
    expect(RU_2027_USD_PER_RUB).toBeCloseTo(0.01081, 5);
    expect(RU_2027_RUB_PER_USD).toBe(92.5);
    expect(1 / RU_2027_USD_PER_RUB).toBeCloseTo(RU_2027_RUB_PER_USD, 1);
  });
});
