import { describe, it, expect } from "vitest";
import { buildCountryClearingBooks } from "./tradePartition";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

const bal = (
  entries: Array<[CommodityType, { supply: number; demand: number }]>
): Map<CommodityType, { supply: number; demand: number }> => new Map(entries);

describe("buildCountryClearingBooks", () => {
  const countries: CountryId[] = ["US", "RU"] as CountryId[];

  it("walls a glut off when the trade lane is blocked (affinity 0)", () => {
    const books = buildCountryClearingBooks({
      countries,
      nationalBalances: new Map([
        ["US" as CountryId, bal([["steel", { supply: 100, demand: 120 }]])],
        ["RU" as CountryId, bal([["steel", { supply: 1000, demand: 200 }]])],
      ]),
      affinityFor: () => 0,
    });
    // RU's 800-unit surplus finds no buyer: its book is domestic demand only.
    expect(books.get("RU" as CountryId)!.get("steel")).toEqual({ supply: 1000, demand: 200 });
    // US keeps its own short market — no imports arrive to eat its demand.
    expect(books.get("US" as CountryId)!.get("steel")).toEqual({ supply: 100, demand: 120 });
  });

  it("routes surplus into deficit demand when the lane is open", () => {
    const books = buildCountryClearingBooks({
      countries,
      nationalBalances: new Map([
        ["US" as CountryId, bal([["steel", { supply: 100, demand: 300 }]])],
        ["RU" as CountryId, bal([["steel", { supply: 1000, demand: 200 }]])],
      ]),
      affinityFor: () => 1,
    });
    // US deficit 200 fully imported from RU: RU book gains 200 export demand.
    expect(books.get("RU" as CountryId)!.get("steel")).toEqual({ supply: 1000, demand: 400 });
    // US producers keep domestic demand net of the 200 imported units.
    expect(books.get("US" as CountryId)!.get("steel")).toEqual({ supply: 100, demand: 100 });
    // Conservation: total book demand equals total ledger demand.
  });

  it("respects embargo unit caps on a lane", () => {
    const books = buildCountryClearingBooks({
      countries,
      nationalBalances: new Map([
        ["US" as CountryId, bal([["steel", { supply: 100, demand: 300 }]])],
        ["RU" as CountryId, bal([["steel", { supply: 1000, demand: 200 }]])],
      ]),
      affinityFor: () => 1,
      capUnitsFor: () => 50,
    });
    const ru = books.get("RU" as CountryId)!.get("steel")!;
    expect(ru.demand).toBeCloseTo(250, 5); // domestic 200 + capped 50 export
    const us = books.get("US" as CountryId)!.get("steel")!;
    expect(us.demand).toBeCloseTo(250, 5); // 300 − 50 imported
  });

  it("skips commodities with no activity anywhere", () => {
    const books = buildCountryClearingBooks({
      countries,
      nationalBalances: new Map([["US" as CountryId, bal([["steel", { supply: 0, demand: 0 }]])]]),
      affinityFor: () => 1,
    });
    expect(books.get("US" as CountryId)!.has("steel")).toBe(false);
  });
});
