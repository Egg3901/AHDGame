import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import type { SectorLedgerRow } from "./ledgerTypes";
import { accumulatePlantsUnits } from "./sectorLedger";

describe("accumulatePlantsUnits product output", () => {
  it("uses exact per-commodity production and clearing units instead of re-splitting", () => {
    const sector: SectorLedgerRow = {
      sectorType: "manufacturing",
      revenue: 300,
      stateId: "S1",
      sectorId: "sector-1",
      corporationId: new ObjectId(),
      isNatcorp: false,
      strategyId: "standard",
      producedUnits: 10,
      soldUnits: 5,
      outputUnitsByCommodity: { steel: 2, vehicles: 3 },
      soldByCommodity: { steel: 0.75, vehicles: 1 / 3 },
      embargoSupplyFactor: 0.5,
    };

    expect(accumulatePlantsUnits([sector], 20, COMMODITY_BASE_PRICES)).toEqual(
      new Map([
        ["steel", { produced: 1, sold: 0.75 }],
        ["vehicles", { produced: 1.5, sold: 0.5 }],
      ])
    );
  });
});
