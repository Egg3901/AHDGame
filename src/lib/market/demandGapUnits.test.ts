import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  demandGapUnitsForMix,
  stateCommodityBalances,
  type CommodityBalance,
} from "./demandGapUnits";

const food = (supply: number, demand: number) =>
  new Map<CommodityType, CommodityBalance>([["food", { supply, demand }]]);

describe("demandGapUnitsForMix", () => {
  it("returns 0 when the mix is empty", () => {
    expect(demandGapUnitsForMix({}, food(0, 100))).toBe(0);
  });

  it("returns 0 in a glut (ticket #1027: extra output does not sell)", () => {
    expect(demandGapUnitsForMix({ food: 0.5 }, food(21_000_000, 14_000_000))).toBe(0);
  });

  it("returns unmet demand for a single-output mix (weight 1)", () => {
    // Live ticket #1077 US food: demand 863551, supply 299765.
    expect(demandGapUnitsForMix({ food: 0.5 }, food(299_765, 863_551))).toBeCloseTo(
      863_551 - 299_765,
      6
    );
  });

  it("does not let a world glut zero a country-short book", () => {
    const worldGlut = food(21_000_000, 14_000_000);
    const usShort = food(299_765, 863_551);
    expect(demandGapUnitsForMix({ food: 0.5 }, worldGlut)).toBe(0);
    expect(demandGapUnitsForMix({ food: 0.5 }, usShort)).toBeGreaterThan(500_000);
  });

  it("returns 0 when any output leg is in glut, even if another is short", () => {
    const mix = { steel: 0.4, building_materials: 0.2 };
    expect(
      demandGapUnitsForMix(
        mix,
        new Map([
          ["steel", { supply: 1000, demand: 100 }],
          ["building_materials", { supply: 10, demand: 1000 }],
        ])
      )
    ).toBe(0);
  });
});

describe("stateCommodityBalances", () => {
  it("reads one state's stored S/D and defaults missing rows to 0", () => {
    const map = stateCommodityBalances(
      [
        {
          commodity: "food",
          stateSupply: { CT: 1_225, NY: 838 },
          stateDemand: { CT: 21_578, NY: 150_692 },
        },
      ],
      "CT"
    );
    expect(map.get("food")).toEqual({ supply: 1_225, demand: 21_578 });
    expect(stateCommodityBalances([{ commodity: "food" }], "CT").get("food")).toEqual({
      supply: 0,
      demand: 0,
    });
  });
});
