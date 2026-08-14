import { describe, it, expect } from "vitest";
import { buildReachableBooks, reachableDemandGap, serializeReachableBooks } from "./reachableBook";
import { clearAllCommodities } from "./snapshot";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

const bal = (
  entries: Array<[CommodityType, { supply: number; demand: number }]>
): Map<CommodityType, { supply: number; demand: number }> => new Map(entries);

const OIL: CommodityType[] = ["oil"];

describe("buildReachableBooks", () => {
  const countries = ["US", "RU"] as CountryId[];

  it("keeps an embargoed glut out of the importer's book and discloses it", () => {
    const balances = new Map([
      ["US" as CountryId, bal([["oil", { supply: 100, demand: 180 }]])],
      ["RU" as CountryId, bal([["oil", { supply: 1000, demand: 200 }]])],
    ]);
    const books = buildReachableBooks({
      countries,
      balances,
      // Nothing clears: the only lane is blocked.
      clearing: clearAllCommodities(countries, balances, () => 0),
      commodities: OIL,
      isBlocked: () => true,
    });

    const us = books.get("US" as CountryId)!.get("oil")!;
    // The US market is genuinely short by 80 even though the world is in glut.
    expect(us.supply).toBe(100);
    expect(us.demand).toBe(180);
    expect(reachableDemandGap(us)).toBe(80);
    // Soviet oil is real, and named, but never enters the arithmetic.
    expect(us.blockedSupply).toBe(1000);
    expect(us.untradedSupply).toBe(0);
  });

  it("closes the book when imports actually arrive", () => {
    const balances = new Map([
      ["US" as CountryId, bal([["oil", { supply: 100, demand: 180 }]])],
      ["RU" as CountryId, bal([["oil", { supply: 1000, demand: 200 }]])],
    ]);
    const books = buildReachableBooks({
      countries,
      balances,
      clearing: clearAllCommodities(countries, balances, () => 1),
      commodities: OIL,
      isBlocked: () => false,
    });

    const us = books.get("US" as CountryId)!.get("oil")!;
    // 80 units imported, so domestic producers face demand 180 - 80 = 100,
    // exactly their own supply. No room for another barrel.
    expect(us.imports).toBeCloseTo(80, 6);
    expect(us.demand).toBeCloseTo(100, 6);
    expect(reachableDemandGap(us)).toBeCloseTo(0, 6);
    expect(us.blockedSupply).toBe(0);
  });

  it("excludes supply from countries outside the trading set as untraded", () => {
    // UKR is seeded and productive but absent from COUNTRY_ORDER, so the
    // clearing engine never sees it and its output reaches no market at all.
    const balances = new Map([
      ["US" as CountryId, bal([["oil", { supply: 100, demand: 180 }]])],
      ["UKR", bal([["oil", { supply: 5000, demand: 10 }]])],
    ]);
    const books = buildReachableBooks({
      countries: ["US"] as CountryId[],
      balances,
      clearing: clearAllCommodities(["US"] as CountryId[], balances, () => 1),
      commodities: OIL,
      isBlocked: () => false,
    });

    const us = books.get("US" as CountryId)!.get("oil")!;
    expect(reachableDemandGap(us)).toBe(80);
    expect(us.untradedSupply).toBe(5000);
    // UKR never gets a book: it is not a trading country.
    expect(books.has("UKR" as CountryId)).toBe(false);
  });

  it("reports no gap for a market that really is in glut", () => {
    const balances = new Map([["US" as CountryId, bal([["oil", { supply: 500, demand: 100 }]])]]);
    const books = buildReachableBooks({
      countries: ["US"] as CountryId[],
      balances,
      clearing: clearAllCommodities(["US"] as CountryId[], balances, () => 1),
      commodities: OIL,
      isBlocked: () => false,
    });
    expect(reachableDemandGap(books.get("US" as CountryId)!.get("oil")!)).toBe(0);
  });

  it("serializes to plain objects for persistence", () => {
    const balances = new Map([["US" as CountryId, bal([["oil", { supply: 1, demand: 2 }]])]]);
    const doc = serializeReachableBooks(
      buildReachableBooks({
        countries: ["US"] as CountryId[],
        balances,
        clearing: clearAllCommodities(["US"] as CountryId[], balances, () => 1),
        commodities: OIL,
        isBlocked: () => false,
      })
    );
    expect(JSON.parse(JSON.stringify(doc)).US.oil.demand).toBe(2);
  });
});

describe("reachableDemandGap", () => {
  it("treats a missing book as no room rather than infinite room", () => {
    expect(reachableDemandGap(undefined)).toBe(0);
  });
});
