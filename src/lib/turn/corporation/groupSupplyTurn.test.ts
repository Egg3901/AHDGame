import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { buildMarketContext } from "@/lib/market/marketContext";
import { configureGroupSupply, groupForecastWriteOps } from "./groupSupplyTurn";
import type { CorporationLookups } from "./types";
describe("group economic activation gates", () => {
  it("adds zero group reads and writes unless both world gates and plants are enabled", async () => {
    const db = {
      collection: () => {
        throw new Error("unexpected database read");
      },
    } as unknown as Db;
    for (const mode of ["off", "realization", "clearing", "capital", "plants"] as const) {
      for (const subsidiaries of [false, true]) {
        for (const enabled of [false, true]) {
          if (mode === "plants" && subsidiaries && enabled) continue;
          const market = buildMarketContext(mode);
          expect(await configureGroupSupply(db, market, subsidiaries, enabled)).toBeUndefined();
          expect(market.groupSupplyEnabled).toBe(false);
          expect(groupForecastWriteOps(market, {} as CorporationLookups)).toEqual([]);
        }
      }
    }
  });
});
