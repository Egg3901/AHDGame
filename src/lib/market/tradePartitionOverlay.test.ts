import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import { overlayReachableClearingBooks, type CountryClearingBooks } from "./tradePartition";

const books = (): CountryClearingBooks =>
  new Map([
    // What re-clearing the post-trade national balances produced on prod t195:
    // Brazil's oil supply already halved by convergence, so its book demand too.
    ["BR" as CountryId, new Map([["oil" as CommodityType, { supply: 12_983, demand: 12_983 }]])],
    ["JP" as CountryId, new Map([["oil" as CommodityType, { supply: 183_980, demand: 537_093 }]])],
  ]);

describe("overlayReachableClearingBooks", () => {
  it("replaces each book with the price turn's pre-trade reachable book", () => {
    const b = books();
    overlayReachableClearingBooks(b, {
      BR: { oil: { supply: 25_942, demand: 25_942 } },
    });
    expect(b.get("BR" as CountryId)?.get("oil" as CommodityType)).toEqual({
      supply: 25_942,
      demand: 25_942,
    });
    // Countries the snapshot does not mention keep their computed book.
    expect(b.get("JP" as CountryId)?.get("oil" as CommodityType)?.demand).toBe(537_093);
  });

  it("is a no-op without a snapshot and skips malformed entries", () => {
    const b = books();
    overlayReachableClearingBooks(b, null);
    overlayReachableClearingBooks(b, { BR: { oil: { supply: Number.NaN, demand: 1 } } });
    expect(b.get("BR" as CountryId)?.get("oil" as CommodityType)?.supply).toBe(12_983);
  });

  it("never adds a country the turn does not trade", () => {
    const b = books();
    overlayReachableClearingBooks(b, { XX: { oil: { supply: 1, demand: 1 } } });
    expect(b.has("XX" as CountryId)).toBe(false);
  });
});
