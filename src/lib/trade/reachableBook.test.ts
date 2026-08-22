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
      affinity: () => 0,
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
      affinity: () => 1,
    });

    const us = books.get("US" as CountryId)!.get("oil")!;
    // 80 units imported, so the CLEARING book pins demand at 180 - 80 = 100,
    // exactly domestic supply. That is correct for what today's producers fill.
    expect(us.imports).toBeCloseTo(80, 6);
    expect(us.demand).toBeCloseTo(100, 6);
    expect(us.domesticDemand).toBeCloseTo(180, 6);
    // But those 80 imported units are room a domestic builder can TAKE:
    // domestic output clears before imports, so new capacity displaces them.
    // Reading the gap off the pinned clearing book returned 0 here and is what
    // kept ticket #1077 reporting "room for 0 farms".
    expect(reachableDemandGap(us)).toBeCloseTo(80, 6);
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
      affinity: () => 1,
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
      affinity: () => 1,
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
        affinity: () => 1,
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

describe("reachableDemandGap — import displacement (ticket #1077 follow-up)", () => {
  const book = (o: Partial<import("./reachableBook").ReachableBookEntry>) => ({
    supply: 0,
    demand: 0,
    domesticDemand: 0,
    imports: 0,
    exports: 0,
    blockedSupply: 0,
    untradedSupply: 0,
    ...o,
  });

  it("reports the displaceable import volume for a net importer", () => {
    // Live prod, turn 113, US food. The clearing book reads demand == supply
    // exactly (imports are set to the residual), so a gap taken off it is
    // identically zero and the player was told "room for 0 farms".
    const us = book({
      supply: 323_218.24676,
      demand: 323_218.24676,
      domesticDemand: 1_438_849.68,
      imports: 1_115_631.43,
    });
    expect(us.demand - us.supply).toBeCloseTo(0, 6); // the old, broken basis
    expect(reachableDemandGap(us)).toBeCloseTo(1_115_631.43, 2);
  });

  it("is zero for a country that genuinely produces more than it can place", () => {
    // Poland: a real glut, so no room regardless of how the book is read.
    const pl = book({
      supply: 4_753_991.37,
      demand: 3_423_124.34,
      domesticDemand: 282_856.05,
      exports: 3_140_268.29,
    });
    expect(reachableDemandGap(pl)).toBe(0);
  });

  it("is unchanged for a self-sufficient country with no imports", () => {
    // US coal: imports 0, so the clearing book was never pinned and the new
    // basis must not move it.
    const coal = book({
      supply: 306_503.02,
      demand: 306_502.97,
      domesticDemand: 175_701.92,
      exports: 130_801.05,
    });
    expect(reachableDemandGap(coal)).toBeCloseTo(0, 0);
  });

  it("counts unmet demand on top of displaceable imports", () => {
    // Imports only partly cover the deficit: room is the whole shortfall.
    const partial = book({ supply: 100, demand: 150, domesticDemand: 400, imports: 250 });
    expect(reachableDemandGap(partial)).toBe(300);
  });

  it("heals a book written before domesticDemand existed", () => {
    // Turn 106-113 documents lack the field; invert demand = max(0, D - imports) + exports.
    const legacy = {
      supply: 323_218.24676,
      demand: 323_218.24676,
      imports: 1_115_631.43,
      exports: 0,
      blockedSupply: 0,
      untradedSupply: 0,
    } as unknown as import("./reachableBook").ReachableBookEntry;
    expect(reachableDemandGap(legacy)).toBeCloseTo(1_115_631.43, 2);
  });
});

describe("unmetForeignDemand", () => {
  const countries = ["US", "UK", "FR"] as CountryId[];

  it("gives a net exporter room equal to its gravity share of unserved foreign demand", () => {
    // FR wants 1000 and makes none. US and UK together can only ship 300, so
    // 700 of French demand goes unserved and is real room for new capacity.
    const balances = new Map([
      ["US" as CountryId, bal([["oil", { supply: 200, demand: 0 }]])],
      ["UK" as CountryId, bal([["oil", { supply: 100, demand: 0 }]])],
      ["FR" as CountryId, bal([["oil", { supply: 0, demand: 1000 }]])],
    ]);
    const books = buildReachableBooks({
      countries,
      balances,
      clearing: clearAllCommodities(countries, balances, () => 1),
      commodities: OIL,
      affinity: () => 1,
    });

    const us = books.get("US" as CountryId)!.get("oil")!;
    const uk = books.get("UK" as CountryId)!.get("oil")!;

    // Both export their whole surplus, so the #1077 term is zero for each and
    // the foreign term is the entire room.
    expect(reachableDemandGap({ ...us, unmetForeignDemand: 0 })).toBe(0);

    // 700 unserved, split by supply mass 200:100 with affinity flat.
    expect(us.unmetForeignDemand).toBeCloseTo(700 * (200 / 300), 6);
    expect(uk.unmetForeignDemand).toBeCloseTo(700 * (100 / 300), 6);
    // The world never sees more room than there is unserved demand.
    expect(us.unmetForeignDemand! + uk.unmetForeignDemand!).toBeCloseTo(700, 6);
  });

  it("gives an embargoed exporter no share of demand it cannot reach", () => {
    const balances = new Map([
      ["US" as CountryId, bal([["oil", { supply: 200, demand: 0 }]])],
      ["UK" as CountryId, bal([["oil", { supply: 100, demand: 0 }]])],
      ["FR" as CountryId, bal([["oil", { supply: 0, demand: 1000 }]])],
    ]);
    const books = buildReachableBooks({
      countries,
      balances,
      clearing: clearAllCommodities(countries, balances, (_c, e) => (e === "US" ? 0 : 1)),
      commodities: OIL,
      // The US cannot ship to anyone; the UK takes the whole unserved pool.
      affinity: (_c, exporter) => (exporter === "US" ? 0 : 1),
    });

    expect(books.get("US" as CountryId)!.get("oil")!.unmetForeignDemand).toBe(0);
    expect(books.get("UK" as CountryId)!.get("oil")!.unmetForeignDemand).toBeGreaterThan(0);
  });

  it("gives no foreign room when every deficit already cleared", () => {
    const balances = new Map([
      ["US" as CountryId, bal([["oil", { supply: 1000, demand: 0 }]])],
      ["UK" as CountryId, bal([["oil", { supply: 0, demand: 100 }]])],
      ["FR" as CountryId, bal([["oil", { supply: 0, demand: 100 }]])],
    ]);
    const books = buildReachableBooks({
      countries,
      balances,
      clearing: clearAllCommodities(countries, balances, () => 1),
      commodities: OIL,
      affinity: () => 1,
    });

    expect(books.get("US" as CountryId)!.get("oil")!.unmetForeignDemand).toBeCloseTo(0, 6);
  });

  it("gives a country producing none of the commodity no export share", () => {
    const balances = new Map([
      ["US" as CountryId, bal([["oil", { supply: 200, demand: 0 }]])],
      ["UK" as CountryId, bal([["oil", { supply: 0, demand: 0 }]])],
      ["FR" as CountryId, bal([["oil", { supply: 0, demand: 1000 }]])],
    ]);
    const books = buildReachableBooks({
      countries,
      balances,
      clearing: clearAllCommodities(countries, balances, () => 1),
      commodities: OIL,
      affinity: () => 1,
    });

    expect(books.get("UK" as CountryId)!.get("oil")!.unmetForeignDemand).toBe(0);
    expect(books.get("US" as CountryId)!.get("oil")!.unmetForeignDemand).toBeCloseTo(800, 6);
  });
});
