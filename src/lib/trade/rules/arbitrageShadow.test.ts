import { describe, it, expect } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { ClearingResult } from "../types";
import { computeArbitrageShadow } from "./arbitrageShadow";

const C = ["JP", "US", "CN"] as CountryId[];
const result = (
  uncleared: Record<string, number>,
  flow: Record<string, Record<string, number>> = {}
): ClearingResult => ({
  flow,
  perCountry: Object.fromEntries(
    C.map((c) => [c, { exports: 0, imports: 0, net: 0, uncleared: uncleared[c] ?? 0 }])
  ),
  clearedVolume: 0,
});
const prices: Record<string, number> = { JP: 100, US: 400, CN: 50 };
const run = (r: ClearingResult, laneOpen: () => boolean = () => true, cost?: () => number) =>
  computeArbitrageShadow({
    countries: C,
    clearing: new Map([["advertising" as CommodityType, r]]),
    priceOf: (_c, country) => prices[country],
    laneOpen,
    importCostMultiplier: cost,
  });

describe("computeArbitrageShadow", () => {
  it("counts surplus that could reach a higher-priced unmet deficit", () => {
    const out = run(result({ JP: 300, US: -500 }));
    expect(out.advertising?.strandedUnits).toBe(300);
    expect(out.advertising?.maxStrandedGapRatio).toBe(4);
  });

  it("ignores closed lanes and gaps eaten by import cost", () => {
    expect(run(result({ JP: 300, US: -500 }), () => false)).toEqual({});
    expect(
      run(
        result({ JP: 300, US: -500 }),
        () => true,
        () => 5
      )
    ).toEqual({});
  });

  it("does not count surplus whose only deficit is cheaper", () => {
    expect(run(result({ JP: 300, CN: -500 }))).toEqual({});
  });

  it("counts shipped units that went to a cheaper market", () => {
    const out = run(result({}, { JP: { CN: 40, US: 10 } }));
    expect(out.advertising).toEqual({
      strandedUnits: 0,
      wrongWayUnits: 40,
      maxStrandedGapRatio: 1,
    });
  });
});
