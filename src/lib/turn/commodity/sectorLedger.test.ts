import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { COMMODITY_BASE_PRICES, commodityMixWeight } from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { computeRawSupplyDemand } from "@/lib/constants/commodities";
import type { SectorLedgerRow } from "./ledgerTypes";
import type { CorporateSector } from "@/lib/db/types";
import { accumulatePlantsUnits, buildSectorRows } from "./sectorLedger";

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

  it("dual-reads a persisted operating model in the plants commodity ledger", () => {
    const sector: SectorLedgerRow = {
      sectorType: "media",
      revenue: 500,
      stateId: "S1",
      sectorId: "media-model-1",
      corporationId: new ObjectId(),
      isNatcorp: false,
      strategyId: "cable_tv",
      producedUnits: 10,
      soldUnits: 5,
      embargoSupplyFactor: 1,
    };
    const supply = getEffectiveStrategyRates("media", "cable_tv", null, null, 20).supply;
    const expected = new Map(
      Object.keys(supply).map((commodity) => {
        const weight = commodityMixWeight(
          supply,
          COMMODITY_BASE_PRICES,
          commodity as keyof typeof COMMODITY_BASE_PRICES
        );
        return [commodity, { produced: 10 * weight, sold: 5 * weight }];
      })
    );

    expect(accumulatePlantsUnits([sector], 20, COMMODITY_BASE_PRICES)).toEqual(expected);
    expect(expected.has("advertising")).toBe(true);
    expect(expected.has("entertainment_services")).toBe(true);
  });
});

describe("automobile model dual-read through commodity pricing", () => {
  it("keeps the legacy recipe when a vehicle sector is stored as manufacturing plus model", () => {
    const id = new ObjectId();
    const base = {
      _id: id,
      corporationId: new ObjectId(),
      stateId: "US-MI",
      countryId: "US",
      strategyId: "standard",
      revenue: 250_000,
      createdAt: new Date(),
    };
    const legacy = buildSectorRows({
      allSectors: [{ ...base, sectorType: "automobiles" } as unknown as CorporateSector],
      corporationById: new Map(),
      natcorpIds: new Set(),
      fxByCurrency: new Map(),
      stateToCountry: new Map([["US-MI", "US"]]),
      ledgerCurrentYear: null,
      ledgerCommandEconomyEnabled: false,
      turn: 1,
    });
    const modelled = buildSectorRows({
      allSectors: [
        {
          ...base,
          sectorType: "manufacturing",
          industryModel: "vehicles",
        } as unknown as CorporateSector,
      ],
      corporationById: new Map(),
      natcorpIds: new Set(),
      fxByCurrency: new Map(),
      stateToCountry: new Map([["US-MI", "US"]]),
      ledgerCurrentYear: null,
      ledgerCommandEconomyEnabled: false,
      turn: 1,
    });

    expect(modelled[0]?.industryModel).toBe("vehicles");
    expect(computeRawSupplyDemand(modelled).global).toEqual(computeRawSupplyDemand(legacy).global);
  });
});
