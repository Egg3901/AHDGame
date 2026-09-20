import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, SectorBuildOrder, UnownedSector } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_BASE_PRICES, computeMarketPrice } from "@/lib/constants/commodities";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { updateScarcityMultiplier } from "@/lib/market/scarcityDrift";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import { makeNppCorpDecision, type NppPlantsContext } from "./nppCorporationBehavior";

const plants: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

const cases = [
  ["healthcare", "healthcare_services"],
  ["entertainment", "entertainment_services"],
  ["logistics", "freight"],
] as const;

describe("NPP chronic-shortage capacity response", () => {
  it.each(cases)(
    "closes a %s shortage even when the incumbent is temporarily loss-making",
    (sectorType, commodity) => {
      const corporation = {
        _id: new ObjectId(),
        name: `${sectorType} NPP`,
        countryId: "US",
        type: sectorType,
        headquartersState: "NY",
        liquidCurrencyCode: "USD",
        liquidCapital: 1_000_000_000_000,
        ceoType: "npp",
        logisticsStrength: 1_000,
      } as unknown as Corporation;
      const sector = {
        _id: new ObjectId(),
        corporationId: corporation._id,
        sectorType,
        countryId: "US",
        stateId: "NY",
        revenue: 100_000_000,
        realizedRevenue: 100_000_000,
        profitMargin: -20,
        effectiveProfitMargin: -20,
        plantsPnl: { revenue: 100_000_000, costs: 120_000_000, profit: -20_000_000 },
        capitalStock: 100,
        operatingCapacityUnits: 100,
        producedUnits: 100,
        soldUnits: 100,
        buildQueue: [],
      } as unknown as CorporateSector;
      const pool = {
        _id: new ObjectId(),
        stateId: "NY",
        countryId: "US",
        sectorType,
        revenue: 100_000_000,
        headroomUnits: 1_000,
      } as unknown as UnownedSector;
      const demand = 300;
      let scarcityMult = 1;

      for (let turn = 1; turn <= 240; turn += 1) {
        const landed = (sector.buildQueue ?? []).filter((order) => order.onlineTurn <= turn);
        sector.capitalStock =
          (sector.capitalStock ?? 0) + landed.reduce((n, o) => n + o.unitsOrdered, 0);
        sector.operatingCapacityUnits = sector.capitalStock;
        sector.buildQueue = (sector.buildQueue ?? []).filter((order) => order.onlineTurn > turn);
        sector.producedUnits = sector.capitalStock;
        sector.soldUnits = Math.min(demand, sector.producedUnits);

        scarcityMult = updateScarcityMultiplier(scarcityMult, sector.producedUnits, demand);
        const basePrice = COMMODITY_BASE_PRICES[commodity];
        const marketPrice = computeMarketPrice(
          basePrice * scarcityMult,
          sector.producedUnits,
          demand
        );
        const decision = makeNppCorpDecision(
          {
            corp: corporation,
            sectors: [sector],
            turn,
            now: new Date("2026-09-20T00:00:00Z"),
            modifiers: ceoArchetypeModifiers("cautious"),
            strategyLoopEnabled: false,
          },
          new Map([["US", [pool]]]),
          new Set(),
          (candidate: CommodityType) => (candidate === commodity ? marketPrice / basePrice : 1),
          plants
        );
        for (const update of decision.sectorUpdates) {
          if (update.filter._id.equals(sector._id) && update.update.$push?.buildQueue) {
            sector.buildQueue!.push(update.update.$push.buildQueue as SectorBuildOrder);
          }
        }
      }

      expect(demand / (sector.producedUnits ?? 1)).toBeLessThanOrEqual(1.15);
      expect(scarcityMult).toBeLessThan(2.5);
    }
  );
});
