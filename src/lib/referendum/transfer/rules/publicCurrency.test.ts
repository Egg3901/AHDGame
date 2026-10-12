import { describe, expect, it } from "vitest";
import type { State } from "@/lib/db/types/state";
import { redenominatePublicRegion } from "./publicCurrency";
describe("public regional currency conversion", () => {
  it("converts money and GDP rewind values without changing turns, people or rates", () => {
    const state = {
      gdp: 100,
      capitalStock: 200,
      population: 50,
      outputGap: -0.1,
      sectorRevenueSnapshots: [{ turn: 100, value: 40 }],
      subhourBase: {
        growth: {
          turn: 100,
          gdp: { base: 90, written: 100 },
          outputGap: { base: -0.2, written: -0.1 },
        },
      },
    } as unknown as State;
    const result = redenominatePublicRegion(state, 1.5);
    expect(result).toMatchObject({
      gdp: 150,
      capitalStock: 300,
      "subhourBase.growth.gdp": { base: 135, written: 150 },
      sectorRevenueSnapshots: [{ turn: 100, value: 60 }],
    });
    expect(result).not.toHaveProperty("population");
    expect(result).not.toHaveProperty("outputGap");
    expect(result).not.toHaveProperty("subhourBase.growth.turn");
    expect(state.gdp).toBe(100);
  });
  it.each([0, -1, Infinity, NaN])("rejects invalid FX %s", (scale) => {
    expect(() => redenominatePublicRegion({} as State, scale)).toThrow();
  });
});
