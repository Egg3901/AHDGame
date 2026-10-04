/**
 * Boundary tests for runClearingPrePass, the extracted corporation-turn
 * clearing pre-pass (offer-book construction, clearing-factors run, book
 * invariant diagnostics, delivered advertising value, loyalty rollup).
 *
 * The extraction moved the `if (market.clearingEnabled)` block out of
 * index.ts verbatim, so these tests pin the new call boundary: a disabled
 * clearing tier must leave the market context and the contract maps exactly
 * as they arrived, with empty breach and loyalty outputs.
 */
import { describe, it, expect } from "vitest";
import { runClearingPrePass, type ClearingPrePassInput } from "./clearingPrePass";
import type { MarketContext } from "@/lib/market/marketContext";
import type { buildCorporationLookups } from "./buildLookups";
import { buildManufacturedSectorOutput } from "@/lib/products/rules/manufacturingRules";
import { eraScaledBasePrices } from "@/lib/constants/commodities";

type Lookups = Awaited<ReturnType<typeof buildCorporationLookups>>;

function makeInput(overrides: Partial<ClearingPrePassInput> = {}): ClearingPrePassInput {
  return {
    lookups: {} as Lookups,
    market: { clearingEnabled: false } as MarketContext,
    turn: 12,
    currentYear: 1953,
    commandEconomyEnabled: false,
    freightSettlementActive: false,
    supplyAgreementsEnabled: false,
    settleableAgreements: undefined,
    contractedByCorpCommodity: undefined,
    contractSettlementByCorp: new Map(),
    producedByCorpCommodity: new Map(),
    achievableByCorpCommodity: new Map(),
    stateLocalClearingBlockedByLegacyAgreement: false,
    brandLoyaltyEnabled: false,
    brandLoyaltySliceEnabled: false,
    qualityPremiumPricingEnabled: false,
    ...overrides,
  };
}

describe("runClearingPrePass with clearing disabled", () => {
  it("returns empty breaches and loyalty updates without touching the market", () => {
    const market = { clearingEnabled: false } as MarketContext;
    const before = { ...market };
    const result = runClearingPrePass(makeInput({ market }));

    expect(result.clearingInvariantBreaches).toEqual([]);
    expect(result.brandLoyaltyUpdates).toEqual([]);
    expect(result.buyerDemandByCorpCommodity).toBeUndefined();
    expect(result.contractedByCorpCommodity).toBeUndefined();
    expect(market).toEqual(before);
  });

  it("passes the incoming contract reservation map through untouched", () => {
    const contractedByCorpCommodity = new Map([["corpA", new Map([["steel", 42]])]]);
    const result = runClearingPrePass(makeInput({ contractedByCorpCommodity }));

    expect(result.contractedByCorpCommodity).toBe(contractedByCorpCommodity);
    expect(result.contractedByCorpCommodity?.get("corpA")?.get("steel")).toBe(42);
  });
});

function makeSectorWorld() {
  const corp = { _id: "corp1", brandLoyalty: 0.5, brandPostureNorm: 0 };
  const sector = {
    _id: "sector1",
    corporationId: "corp1",
    sectorType: "manufacturing",
    strategyId: "standard",
    revenue: 1_000_000,
    producedUnits: 100,
    contractAchievableUnits: 100,
  };
  const lookups = {
    sectorsByCorp: new Map([["corp1", [sector]]]),
    corpById: new Map([["corp1", corp]]),
    globalCommodityBalances: new Map(),
    priceRatioByCommodity: new Map(),
    eraUnitScale: 1,
    exchangeRatesByCurrency: new Map(),
    stateResourceCapacityByState: new Map(),
    countryClearingBooks: undefined,
    rawStateBalances: new Map(),
    statePriceRatioByState: new Map(),
    reachablePriceRatioByCountry: new Map(),
  } as unknown as Lookups;
  return { corp, sector, lookups };
}

describe("runClearingPrePass with clearing enabled", () => {
  it("does not read the new pricing mode while explicit costs are disabled", () => {
    const { sector, lookups } = makeSectorWorld();
    Object.defineProperty(sector, "costPlusCostBasis", {
      get() {
        throw new Error("disabled cost basis read");
      },
    });
    Object.defineProperty(sector, "pricingMode", {
      get() {
        throw new Error("disabled mode read");
      },
    });
    const market = {
      clearingEnabled: true,
      plantsEnabled: true,
      explicitPlantCostsEnabled: false,
    } as MarketContext;
    expect(() => runClearingPrePass(makeInput({ lookups, market }))).not.toThrow();
  });
  it("does not read media regulation history while the flag is off", () => {
    const { sector, lookups } = makeSectorWorld();
    sector.sectorType = "media";
    Object.defineProperty(sector, "outputUnitsByCommodity", {
      get() {
        throw new Error("disabled media history read");
      },
    });
    const market = { clearingEnabled: true, plantsEnabled: false } as MarketContext;

    expect(() => runClearingPrePass(makeInput({ lookups, market }))).not.toThrow();
  });
  it("populates clearing results on the market and reports deterministic breaches", () => {
    const { lookups } = makeSectorWorld();
    const market = { clearingEnabled: true, plantsEnabled: false } as MarketContext;
    const result = runClearingPrePass(makeInput({ lookups, market }));

    expect(market.clearingBySectorId?.has("sector1")).toBe(true);
    expect(market.advertisingSellerDeliveredValueAnchorByCorpId).toBeDefined();
    expect(result.clearingInvariantBreaches.length).toBeGreaterThan(0);
    for (const breach of result.clearingInvariantBreaches) {
      expect(breach.startsWith("corporationTurn: ")).toBe(true);
    }
    expect(result.brandLoyaltyUpdates).toEqual([]);
    expect(result.buyerDemandByCorpCommodity).toBeUndefined();
    expect(result.contractedByCorpCommodity).toBeUndefined();
  });

  it("limits the next clearing book using prior measured ad share", () => {
    const { corp, sector, lookups } = makeSectorWorld();
    Object.assign(sector, {
      stateId: "US-CA",
      countryId: "US",
      sectorType: "media",
      strategyId: "standard",
      producedUnits: 90,
      soldFraction: 1,
      soldByCommodity: { advertising: 1 },
    });
    const competitor = {
      ...sector,
      _id: "sector2",
      corporationId: "corp2",
      producedUnits: 10,
    };
    Object.assign(lookups, {
      sectorsByCorp: new Map([
        ["corp1", [sector]],
        ["corp2", [competitor]],
      ]),
      corpById: new Map([
        ["corp1", corp],
        ["corp2", { _id: "corp2", brandLoyalty: 0.5, brandPostureNorm: 0 }],
      ]),
      globalCommodityBalances: new Map([["advertising", { supply: 1_000, demand: 1_000 }]]),
      stateMetricsByState: new Map([
        [
          "US-CA",
          { mediaInformation: { pressFreedom: { value: 100 }, stateMediaControl: { value: 0 } } },
        ],
      ]),
    });
    const market = {
      clearingEnabled: true,
      plantsEnabled: true,
      mediaRegulationEnabled: true,
      mediaRegulationPolicyOptionIndex: 0,
    } as MarketContext;

    runClearingPrePass(makeInput({ lookups, market }));

    const dominantFill = market.clearingBySectorId?.get("sector1")?.soldByCommodity?.advertising;
    const competitorFill = market.clearingBySectorId?.get("sector2")?.soldByCommodity?.advertising;
    expect(dominantFill).toBeGreaterThan(0);
    expect(dominantFill).toBeLessThan(competitorFill ?? 0);
  });
  it("uses the pre-repeal fairness law to constrain divergent outlet reach", () => {
    const { corp, sector, lookups } = makeSectorWorld();
    Object.assign(corp, { editorialStance: { economic: 5, social: 5 } });
    Object.assign(sector, {
      stateId: "CA",
      countryId: "US",
      sectorType: "media",
      strategyId: "standard",
      producedUnits: 100,
    });
    Object.assign(lookups, {
      globalCommodityBalances: new Map([["advertising", { supply: 100, demand: 100 }]]),
      editorialAudienceLeanByState: new Map([["CA", { economic: -5, social: -5 }]]),
    });
    const fairMarket = {
      clearingEnabled: true,
      plantsEnabled: true,
      mediaFairnessDoctrineEnabled: true,
      mediaEditorialEnabled: false,
    } as MarketContext;
    const postRepealMarket = {
      clearingEnabled: true,
      plantsEnabled: true,
      mediaFairnessDoctrineEnabled: false,
      mediaEditorialEnabled: false,
    } as MarketContext;

    runClearingPrePass(makeInput({ lookups, market: fairMarket }));
    const fairnessFill =
      fairMarket.clearingBySectorId?.get("sector1")?.soldByCommodity?.advertising;
    runClearingPrePass(makeInput({ lookups, market: postRepealMarket }));
    const postRepealFill =
      postRepealMarket.clearingBySectorId?.get("sector1")?.soldByCommodity?.advertising;

    expect(fairnessFill).toBeGreaterThan(0);
    expect(fairnessFill).toBeLessThan(postRepealFill ?? 0);
  });

  it("limits the Fairness Doctrine to US outlets while preserving global editorial stance effects", () => {
    const { corp, sector, lookups } = makeSectorWorld();
    Object.assign(corp, { editorialStance: { economic: 5, social: 5 } });
    Object.assign(sector, {
      stateId: "GB-LON",
      countryId: "GB",
      sectorType: "media",
      strategyId: "standard",
      producedUnits: 100,
    });
    Object.assign(lookups, {
      globalCommodityBalances: new Map([["advertising", { supply: 100, demand: 100 }]]),
      editorialAudienceLeanByState: new Map([["GB-LON", { economic: -5, social: -5 }]]),
    });

    const fairnessMarket = {
      clearingEnabled: true,
      plantsEnabled: true,
      mediaFairnessDoctrineEnabled: true,
      mediaEditorialEnabled: false,
    } as MarketContext;
    const noFairnessMarket = {
      clearingEnabled: true,
      plantsEnabled: true,
      mediaFairnessDoctrineEnabled: false,
      mediaEditorialEnabled: false,
    } as MarketContext;
    const editorialMarket = {
      clearingEnabled: true,
      plantsEnabled: true,
      mediaFairnessDoctrineEnabled: false,
      mediaEditorialEnabled: true,
    } as MarketContext;

    runClearingPrePass(makeInput({ lookups, market: fairnessMarket }));
    const fairnessFill =
      fairnessMarket.clearingBySectorId?.get("sector1")?.soldByCommodity?.advertising;
    runClearingPrePass(makeInput({ lookups, market: noFairnessMarket }));
    const noFairnessFill =
      noFairnessMarket.clearingBySectorId?.get("sector1")?.soldByCommodity?.advertising;
    runClearingPrePass(makeInput({ lookups, market: editorialMarket }));
    const editorialFill =
      editorialMarket.clearingBySectorId?.get("sector1")?.soldByCommodity?.advertising;

    expect(fairnessFill).toBe(noFairnessFill);
    expect(editorialFill).toBeGreaterThan(0);
    expect(editorialFill).toBeLessThan(noFairnessFill ?? 0);
  });
  it("rolls loyalty up and keeps the in-memory corp docs consistent", () => {
    const { corp, lookups } = makeSectorWorld();
    const market = { clearingEnabled: true, plantsEnabled: false } as MarketContext;
    const result = runClearingPrePass(makeInput({ lookups, market, brandLoyaltyEnabled: true }));

    expect(result.brandLoyaltyUpdates.length).toBeGreaterThan(0);
    for (const lu of result.brandLoyaltyUpdates) {
      expect(lookups.corpById.get(lu.corpId)).toBe(corp);
      expect(corp.brandLoyalty).toBe(Math.round(lu.loyalty * 100) / 100);
      expect(corp.brandPostureNorm).toBe(Math.round(lu.postureNorm * 10000) / 10000);
    }
  });

  it("returns buyer demand and reservation maps on the agreements path", () => {
    const { lookups } = makeSectorWorld();
    const market = { clearingEnabled: true, plantsEnabled: false } as MarketContext;
    const result = runClearingPrePass(
      makeInput({
        lookups,
        market,
        supplyAgreementsEnabled: true,
        settleableAgreements: [],
        contractedByCorpCommodity: new Map(),
      })
    );

    expect(result.buyerDemandByCorpCommodity).toBeDefined();
    expect(result.contractedByCorpCommodity).toBeDefined();
    expect(result.contractedByCorpCommodity?.size).toBe(0);
  });

  it("rebuilds offers from current capacity and project stage instead of stale product maps", () => {
    const { lookups } = makeSectorWorld();
    const sector = lookups.sectorsByCorp.get("corp1")![0];
    Object.assign(sector, {
      capitalStock: 200,
      plantCount: 1,
      producedUnits: 100,
      operatingCapacityUnits: 200,
      productOutputCapacityUnits: 100,
      outputUnitsByCommodity: { vehicles: 20 },
      outputAnchorByCommodity: { vehicles: 5000 },
      productQualityByCommodity: { vehicles: 72 },
    });
    Object.assign(lookups, {
      productLinesV2Enabled: true,
      manufacturingProductByCorpId: new Map([
        [
          "corp1",
          {
            _id: "project-1",
            corporationId: "corp1",
            activeCorporationId: "corp1",
            kindId: "cement",
            stage: "mature",
            stageStartedTurn: 1,
            allocations: [{ sectorId: "sector1", share: 0.5 }],
            startedTurn: 1,
            developmentPaidAnchor: 400,
            paidThresholdAnchor: 500,
            elapsedDevelopmentTurns: 1,
            elapsedThresholdTurns: 1,
          },
        ],
      ]),
      productSectorQualityById: new Map([["sector1", 70]]),
    });
    const market = { clearingEnabled: true, plantsEnabled: true } as MarketContext;
    const producedByCorpCommodity = new Map<string, Map<string, number>>();

    runClearingPrePass(
      makeInput({
        lookups,
        market,
        producedByCorpCommodity,
        supplyAgreementsEnabled: true,
        settleableAgreements: [],
        contractedByCorpCommodity: new Map(),
      })
    );

    const basePrices = eraScaledBasePrices(lookups.eraUnitScale);
    const expected = buildManufacturedSectorOutput({
      outputAnchor: 200 * (basePrices.steel! * 0.5 + basePrices.building_materials! * 0.5),
      supplyRates: { steel: 0.4, building_materials: 0.2 },
      allocationShare: 0.5,
      stage: "mature",
      outputCommodity: "building_materials",
      basePrices,
      currentSectorQualityByCommodity: { steel: 70, building_materials: 70 },
      paidDevelopmentAnchor: 400,
      paidThresholdAnchor: 500,
    });
    expect(market.clearingBySectorId?.get("sector1")?.soldByCommodity).toHaveProperty("steel");
    expect(market.clearingBySectorId?.get("sector1")?.soldByCommodity).toHaveProperty(
      "building_materials"
    );
    expect(market.clearingBySectorId?.get("sector1")?.soldByCommodity).not.toHaveProperty(
      "vehicles"
    );
    expect(producedByCorpCommodity.get("corp1")?.get("steel")).toBeCloseTo(
      expected.outputUnitsByCommodity.steel!
    );
    expect(producedByCorpCommodity.get("corp1")?.get("building_materials")).toBeCloseTo(
      expected.outputUnitsByCommodity.building_materials!
    );
    expect(producedByCorpCommodity.get("corp1")?.get("vehicles")).toBeUndefined();
  });
});
