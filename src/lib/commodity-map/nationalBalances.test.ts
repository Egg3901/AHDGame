import { describe, it, expect } from "vitest";
import { getNationalCommodityBalance, buildNationalCommodityBalances } from "./nationalBalances";

const stateCountryMap = new Map<string, string>([
  ["us_ca", "US"],
  ["us_tx", "US"],
  ["uk_england", "UK"],
]);

describe("getNationalCommodityBalance", () => {
  it("prefers stored nationalSupply/nationalDemand over state sum", () => {
    // Simulates post-turn state: govt healthcare adds 500 units of demand to
    // byCountry but is never distributed to states, so state sum (40) is far
    // below the authoritative national demand (540).
    const cp = {
      nationalSupply: { US: 100 },
      nationalDemand: { US: 540 },
      stateSupply: { us_ca: 60, us_tx: 40 },
      stateDemand: { us_ca: 30, us_tx: 10 },
    };

    const result = getNationalCommodityBalance(cp, "US", stateCountryMap);
    expect(result).toEqual({ supply: 100, demand: 540 });
  });

  it("falls back to state sum when stored national fields are absent", () => {
    const cp = {
      stateSupply: { us_ca: 60, us_tx: 40 },
      stateDemand: { us_ca: 30, us_tx: 10 },
    };

    const result = getNationalCommodityBalance(cp, "US", stateCountryMap);
    expect(result).toEqual({ supply: 100, demand: 40 });
  });

  it("returns zero demand when only nationalSupply is stored (partial authoritative)", () => {
    const cp = {
      nationalSupply: { US: 100 },
      stateSupply: { us_ca: 60, us_tx: 40 },
      stateDemand: { us_ca: 30, us_tx: 10 },
    };

    const result = getNationalCommodityBalance(cp, "US", stateCountryMap);
    expect(result).toEqual({ supply: 100, demand: 0 });
  });

  it("scopes the fallback sum to states in the requested country", () => {
    const cp = {
      stateSupply: { us_ca: 60, us_tx: 40, uk_england: 999 },
      stateDemand: { us_ca: 30, us_tx: 10, uk_england: 888 },
    };

    expect(getNationalCommodityBalance(cp, "US", stateCountryMap)).toEqual({
      supply: 100,
      demand: 40,
    });
    expect(getNationalCommodityBalance(cp, "UK", stateCountryMap)).toEqual({
      supply: 999,
      demand: 888,
    });
  });
});

describe("buildNationalCommodityBalances", () => {
  it("uses stored national fields when populated", () => {
    const cp = {
      nationalSupply: { US: 100, UK: 50 },
      nationalDemand: { US: 540, UK: 70 },
      stateSupply: { us_ca: 1, uk_england: 1 },
      stateDemand: { us_ca: 1, uk_england: 1 },
    };

    const result = buildNationalCommodityBalances(cp, stateCountryMap);
    expect(result.get("US")).toEqual({ supply: 100, demand: 540 });
    expect(result.get("UK")).toEqual({ supply: 50, demand: 70 });
  });

  it("falls back to summing states when stored national fields are empty", () => {
    const cp = {
      nationalSupply: {},
      nationalDemand: {},
      stateSupply: { us_ca: 60, us_tx: 40, uk_england: 20 },
      stateDemand: { us_ca: 30, us_tx: 10, uk_england: 15 },
    };

    const result = buildNationalCommodityBalances(cp, stateCountryMap);
    expect(result.get("US")).toEqual({ supply: 100, demand: 40 });
    expect(result.get("UK")).toEqual({ supply: 20, demand: 15 });
  });
});
