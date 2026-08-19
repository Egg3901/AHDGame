import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { buildSourcingDocs } from "./sourcingLedger";
import type { SourcingResult } from "./sourcing";

function baseResult(overrides: Partial<SourcingResult> = {}): SourcingResult {
  return {
    flows: [],
    summaries: [],
    freightTeuByState: new Map(),
    landedPremiumByDestState: new Map(),
    importAggregatesByCountry: new Map(),
    unplacedSupplyByState: new Map(),
    deliveryLimitedSupplyByState: new Map(),
    ...overrides,
  };
}

describe("buildSourcingDocs — money wiring fields", () => {
  it("rounds premiumPerUnit to 4 decimals and omits zero/negative entries", () => {
    const landedPremiumByDestState = new Map<
      string,
      Map<CommodityType, { metUnits: number; extraCost: number }>
    >([
      [
        "A1",
        new Map([
          ["coal", { metUnits: 100, extraCost: 40.00006 }], // premium 0.4000006 -> 0.4
          ["oil", { metUnits: 100, extraCost: 0 }], // premium 0 -> omitted
          ["steel", { metUnits: 0, extraCost: 50 }], // metUnits <= 0 -> omitted
        ]),
      ],
    ]);
    const { networkDoc } = buildSourcingDocs(
      baseResult({ landedPremiumByDestState }),
      10,
      new Date()
    );
    expect(networkDoc.landedPremiums.A1).toEqual({ coal: 0.4 });
    expect(networkDoc.landedPremiums.A1.oil).toBeUndefined();
    expect(networkDoc.landedPremiums.A1.steel).toBeUndefined();
  });

  it("omits a state entirely when every commodity premium is omitted", () => {
    const landedPremiumByDestState = new Map<
      string,
      Map<CommodityType, { metUnits: number; extraCost: number }>
    >([["A1", new Map([["coal", { metUnits: 100, extraCost: 0 }]])]]);
    const { networkDoc } = buildSourcingDocs(
      baseResult({ landedPremiumByDestState }),
      10,
      new Date()
    );
    expect(networkDoc.landedPremiums.A1).toBeUndefined();
  });

  it("rounds importAggregates to 2 decimals and omits zero entries", () => {
    const importAggregatesByCountry = new Map([
      ["US", { tariffPaid: 12.3456, importValue: 100.005 }],
      ["UK", { tariffPaid: 0, importValue: 0 }],
    ]);
    const { networkDoc } = buildSourcingDocs(
      baseResult({ importAggregatesByCountry }),
      10,
      new Date()
    );
    expect(networkDoc.importAggregates.US).toEqual({ tariffPaid: 12.35, importValue: 100.01 });
    expect(networkDoc.importAggregates.UK).toBeUndefined();
  });
});
