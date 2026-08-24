import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import {
  commodityDemandGap,
  commodityMarketScope,
  supportsCorporationWideSupplyAgreement,
} from "./commodityMarketScope";

describe("commodityMarketScope", () => {
  it("makes freight the only state-local commodity", () => {
    expect(commodityMarketScope("freight")).toBe("state");
    for (const commodity of COMMODITY_TYPES) {
      if (commodity === "freight") continue;
      expect(commodityMarketScope(commodity), commodity).toBe("reachable");
    }
  });

  it("keeps state-local commodities out of corporation-wide agreements", () => {
    expect(supportsCorporationWideSupplyAgreement("freight")).toBe(false);
    expect(supportsCorporationWideSupplyAgreement("steel")).toBe(true);
  });

  it("uses the state gap for freight even when its reachable country is glutted", () => {
    expect(
      commodityDemandGap({
        commodity: "freight",
        stateBalance: { supply: 100, demand: 180 },
        reachableBook: {
          supply: 1_000,
          demand: 400,
          domesticDemand: 400,
          imports: 0,
          exports: 0,
          blockedSupply: 0,
          untradedSupply: 0,
        },
        globalBalance: { supply: 2_000, demand: 500 },
      })
    ).toBe(80);
  });

  it("fails a state-local gap closed when its state balance is missing", () => {
    expect(
      commodityDemandGap({
        commodity: "freight",
        reachableBook: {
          supply: 10,
          demand: 100,
          domesticDemand: 100,
          imports: 0,
          exports: 0,
          blockedSupply: 0,
          untradedSupply: 0,
        },
      })
    ).toBe(0);
  });

  it("keeps every reachable commodity on its reachable book", () => {
    const reachableBook = {
      supply: 100,
      demand: 100,
      domesticDemand: 140,
      imports: 40,
      exports: 0,
      blockedSupply: 0,
      untradedSupply: 0,
      unmetForeignDemand: 10,
    };
    for (const commodity of COMMODITY_TYPES as readonly CommodityType[]) {
      if (commodity === "freight") continue;
      expect(
        commodityDemandGap({
          commodity,
          stateBalance: { supply: 0, demand: 999 },
          reachableBook,
          globalBalance: { supply: 1_000, demand: 0 },
        }),
        commodity
      ).toBe(50);
    }
  });
});
