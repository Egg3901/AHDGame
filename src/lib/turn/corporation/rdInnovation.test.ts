/**
 * Unit tests for processRdInnovations — pure-computation R&D breakthrough phase.
 *
 * processRdInnovations is a pure function that accepts pre-built lookup maps
 * and returns bulk write ops for sector revenue boosts and state resource
 * capacity boosts. Tests cover: interval gating, probability gating, boost
 * magnitude floors (Q2), multi-resource capacity allocation (Q4), currency
 * handling (no double-conversion — boostAmount stays in corp-local), and
 * capacity skipping for states without a capacity doc.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { processRdInnovations } from "./rdInnovation";
import type { CorporationLookups } from "./types";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { ExtractableResource } from "@/lib/constants/commodities";
import {
  RD_EXTRACTION_BOOST_MAX,
  RD_REGULAR_BOOST_MIN,
  RD_REGULAR_BOOST_MAX,
  RD_CAPACITY_BOOST_MIN_PCT,
  RD_INNOVATION_INTERVAL,
} from "@/lib/constants/corporations";

// Stub the notification side effect so tests don't hit the DB layer.
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

function baseLookups(
  corporations: Corporation[],
  sectors: CorporateSector[],
  opts: {
    stateResourceCapacity?: Map<string, Partial<Record<ExtractableResource, number>>>;
  } = {}
): CorporationLookups {
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const k = s.corporationId.toString();
    sectorsByCorp.set(k, [...(sectorsByCorp.get(k) ?? []), s]);
  }
  return {
    eraUnitScale: 1,
    corporations,
    sectorsByCorp,
    corpById: new Map(corporations.map((c) => [c._id.toString(), c])),
    ceoBusinessAcumenByCorpId: new Map(),
    bondsByCorpId: new Map(),
    bondsHeldByCorpId: new Map(),
    portfolioAnchorValueByCorpId: new Map(),
    bondAndImfPortfolioAnchorByCorpId: new Map(),
    issuedBondDebtByCorpId: new Map(),
    crossCorpStockHoldingsByHolderCorpId: new Map(),
    primeRateByCountry: new Map(),
    macroInflationByCountry: new Map(),
    investorConfidenceByCountry: new Map(),
    macroDebtToGdpByCountry: new Map(),
    macroDeficitByCountry: new Map(),
    sovereignDefaultMarginByCorpId: new Map(),
    unemploymentByState: new Map(),
    gridReliabilityByState: new Map(),
    corruptionByState: new Map(),
    workforceSkillByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    crimeRateByState: new Map(),
    broadbandByState: new Map(),
    roadConditionByState: new Map(),
    carbonEmissionsByState: new Map(),
    costOfLivingByState: new Map(),
    globalCommodityBalances: new Map(),
    priceRatioByCommodity: new Map(),
    landedPremiumByState: new Map(),
    nationalCommodityBalancesByCountry: new Map(),
    countryClearingBooks: null,
    exportIntensityByCountry: new Map(),
    rawStateBalances: new Map(),
    sectorPresenceKeys: new Set(),
    allTariffs: [],
    activeFtaPairs: new Set<string>(),
    ftaCoverage: {
      byCountryEconomyWide: new Map(),
      bySectorType: new Map(),
      corpHqByCorpId: new Map(),
      pairs: new Set<string>(),
    },
    activeSubsidies: [],
    federalBudgets: [],
    domesticCorpTaxRateByCountry: new Map(),
    foreignCorpTaxRateByCountry: new Map(),
    domesticStateCorpTaxRateByState: new Map(),
    foreignStateCorpTaxRateByState: new Map(),
    // JP corp at 150 JPY/USD anchor — used by currency-safety test to prove
    // that boostAmount is NOT double-converted through the FX rate.
    exchangeRatesByCurrency: new Map([
      ["USD", 1.0],
      ["JPY", 150],
    ]),
    stateCountryMap: new Map(),
    stateResourceCapacityByState: opts.stateResourceCapacity ?? new Map(),
    extractionCapacityUtilBySector: new Map(),
    marketShareBySectorId: new Map(),
    stateSectorSpecializationByState: new Map(),
    activeDisasterEffectsByState: new Map(),
  };
}

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "TestCorp",
    type: "manufacturing",
    secondaryType: null,
    countryId: "US",
    headquartersState: "US-CA",
    liquidCapital: 0,
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    rdBudget: 0,
    rdScore: 0,
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    totalShares: 10_000_000,
    sharePrice: 1.0,
    shareholders: [],
    dividendRate: 0,
    ceoSalary: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Corporation;
}

function makeSector(corpId: ObjectId, overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    countryId: "US",
    stateId: "US-CA",
    sectorType: "manufacturing",
    revenue: 100_000,
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    profitMargin: 50,
    workers: 100,
    strategyId: "standard",
    transitionFromStrategyId: null,
    transitionStartTurn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CorporateSector;
}

describe("processRdInnovations", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  beforeEach(() => {
    // Force Math.random() to return 0 so every probability check passes —
    // rdScore > 0 → probability > 0 → 0 <= probability always.
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("under plants boosts capitalStock by the same percentage and never writes revenue", () => {
    const corp = makeCorp({ rdScore: 200 });
    const sector = makeSector(corp._id, { capitalStock: 1_000 });
    const result = processRdInnovations(
      baseLookups([corp], [sector]),
      6,
      now,
      () => 0,
      /* plantsEnabled */ true
    );

    expect(result.innovationsTriggered).toBe(1);
    const update = result.sectorBoostOps[0]!.updateOne.update;
    expect(update.$inc.revenue).toBeUndefined();
    // rng 0 → the MIN of the regular boost band, applied to the STOCK.
    expect(update.$inc.capitalStock).toBeGreaterThan(0);
    expect(update.$inc.capitalStock).toBeLessThan(1_000);
  });

  it("under plants skips a sector with no capacity to improve", () => {
    const corp = makeCorp({ rdScore: 200 });
    const sector = makeSector(corp._id, { capitalStock: 0 });
    const result = processRdInnovations(
      baseLookups([corp], [sector]),
      6,
      now,
      () => 0,
      /* plantsEnabled */ true
    );
    expect(result.sectorBoostOps).toHaveLength(0);
  });

  it("returns empty ops when turn is not on the innovation interval", () => {
    const corp = makeCorp({ rdScore: 200 });
    const sector = makeSector(corp._id);
    const result = processRdInnovations(baseLookups([corp], [sector]), 5, now);

    // RD_INNOVATION_INTERVAL === 6, so turn 5 % 6 !== 0
    expect(5 % RD_INNOVATION_INTERVAL).not.toBe(0);
    expect(result.innovationsTriggered).toBe(0);
    expect(result.sectorBoostOps).toHaveLength(0);
    expect(result.capacityBoostOps).toHaveLength(0);
  });

  it("skips corps with rdScore = 0", () => {
    const corp = makeCorp({ rdScore: 0 });
    const sector = makeSector(corp._id);
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(0);
    expect(result.sectorBoostOps).toHaveLength(0);
  });

  it("skips corps when Math.random exceeds probability", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const corp = makeCorp({ rdScore: 50 }); // probability 0.25 < 0.99
    const sector = makeSector(corp._id);
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(0);
  });

  it("rolls boost magnitude uniformly across [MIN, MAX] at rdScore = 200 (regular corp)", () => {
    // Three Math.random() calls per breakthrough: (1) proc check, (2) sector
    // picker, (3) magnitude roll. Default beforeEach mock returns 0, used for
    // calls we don't override here.
    const randSpy = vi.spyOn(Math, "random");
    randSpy.mockReturnValueOnce(0); // proc — always passes
    randSpy.mockReturnValueOnce(0); // sector picker → sectors[0]
    randSpy.mockReturnValueOnce(1); // magnitude — full MAX
    const corp = makeCorp({ rdScore: 200, type: "manufacturing" });
    const sector = makeSector(corp._id, { revenue: 100_000 });
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(1);
    expect(result.sectorBoostOps).toHaveLength(1);
    const op = result.sectorBoostOps[0];
    expect(op.updateOne.update.$inc.revenue).toBe(Math.round(100_000 * RD_REGULAR_BOOST_MAX));
  });

  it("magnitude is RNG, not a function of rdScore (same score → different rolls produce different boosts)", () => {
    // Run two breakthroughs at the same high rdScore but different magnitude rolls.
    const randSpy = vi.spyOn(Math, "random");
    const corp = makeCorp({ rdScore: 200, type: "manufacturing" });
    const sectorA = makeSector(corp._id, { revenue: 100_000 });
    const sectorB = makeSector(corp._id, { revenue: 100_000 });

    randSpy.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0.25); // proc, sector, magnitude
    const a = processRdInnovations(baseLookups([corp], [sectorA]), 6, now);

    randSpy.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0.9);
    const b = processRdInnovations(baseLookups([corp], [sectorB]), 6, now);

    const boostA = a.sectorBoostOps[0].updateOne.update.$inc.revenue;
    const boostB = b.sectorBoostOps[0].updateOne.update.$inc.revenue;
    expect(boostB).toBeGreaterThan(boostA);
  });

  it("applies the regular-corp minimum floor when magnitude roll is 0 (Q2)", () => {
    // Default mock: Math.random → 0 for both proc and magnitude.
    // Magnitude roll of 0 → boost = MIN exactly.
    const corp = makeCorp({ rdScore: 1, type: "manufacturing" });
    const sector = makeSector(corp._id, { revenue: 100_000 });
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(1);
    const op = result.sectorBoostOps[0];
    expect(op.updateOne.update.$inc.revenue).toBe(Math.round(100_000 * RD_REGULAR_BOOST_MIN));
  });

  it("applies RD_EXTRACTION_BOOST_MAX for extraction corps when magnitude roll is 1.0", () => {
    const randSpy = vi.spyOn(Math, "random");
    // Extraction corps pick the sector by capacity utilization (no RNG sector
    // roll), so the calls are: (1) proc check, (2) magnitude roll.
    randSpy.mockReturnValueOnce(0).mockReturnValueOnce(1); // proc, magnitude
    const corp = makeCorp({ rdScore: 200, type: "extraction" });
    const sector = makeSector(corp._id, { sectorType: "extraction", revenue: 100_000 });
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(1);
    const op = result.sectorBoostOps[0];
    expect(op.updateOne.update.$inc.revenue).toBe(Math.round(100_000 * RD_EXTRACTION_BOOST_MAX));
  });

  it("does NOT double-convert boost through FX (JP corp currency-safety)", () => {
    // Pre-fix: boostAmount was passed through anchorToCorpCapital(..., "JPY", 150),
    // inflating the $inc by ~150×. Now boostAmount is written local directly.
    const randSpy = vi.spyOn(Math, "random");
    randSpy.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(1); // proc, sector, magnitude → MAX
    const corp = makeCorp({
      rdScore: 200,
      type: "manufacturing",
      countryId: "JP",
      liquidCurrencyCode: "JPY",
    });
    const sector = makeSector(corp._id, { revenue: 1_000_000 }); // ¥1M local
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(1);
    // Expected boost: ¥1M × MAX = ¥50,000 (post-rebalance). If FX bug returned, we'd see ~¥7.5M.
    const op = result.sectorBoostOps[0];
    expect(op.updateOne.update.$inc.revenue).toBe(Math.round(1_000_000 * RD_REGULAR_BOOST_MAX));
  });

  it("skips capacity boost for states without a capacity document", () => {
    const corp = makeCorp({ rdScore: 200, type: "extraction" });
    const sector = makeSector(corp._id, { sectorType: "extraction", strategyId: "iron_mining" });
    // No entry in stateResourceCapacityByState → uncapped state
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(1);
    expect(result.sectorBoostOps).toHaveLength(1);
    expect(result.capacityBoostOps).toHaveLength(0);
  });

  it("allocates capacity boost across all extractable resources in the strategy (Q4)", () => {
    // oil_gas strategy: supply { oil: 0.4, natural_gas: 0.2 }
    const corp = makeCorp({ rdScore: 200, type: "extraction" });
    const sector = makeSector(corp._id, {
      sectorType: "extraction",
      strategyId: "oil_gas",
      stateId: "US-TX",
    });
    const cap = new Map<string, Partial<Record<ExtractableResource, number>>>();
    cap.set("US-TX", { oil: 100_000, natural_gas: 50_000 });
    const result = processRdInnovations(
      baseLookups([corp], [sector], { stateResourceCapacity: cap }),
      6,
      now
    );

    expect(result.innovationsTriggered).toBe(1);
    expect(result.capacityBoostOps).toHaveLength(1);
    const op = result.capacityBoostOps[0];
    expect(op.updateOne.filter.stateId).toBe("US-TX");
    // Capacity boost is a per-resource percentage of the state's CURRENT
    // capacity, rolled in [MIN_PCT, MAX_PCT]. Math.random is mocked to 0, so
    // every roll lands on the minimum: increase = round(currentCap × MIN_PCT).
    const oilIncrement = op.updateOne.update.$inc["resources.oil"];
    const gasIncrement = op.updateOne.update.$inc["resources.natural_gas"];
    expect(oilIncrement).toBe(Math.round(100_000 * RD_CAPACITY_BOOST_MIN_PCT));
    expect(gasIncrement).toBe(Math.round(50_000 * RD_CAPACITY_BOOST_MIN_PCT));
    // Larger existing deposit → larger absolute boost (percent-of-cap scaling).
    expect(oilIncrement).toBeGreaterThan(gasIncrement);
  });

  it("aggregates multiple breakthroughs in the same state into a single bulk op", () => {
    const corpA = makeCorp({ rdScore: 200, type: "extraction" });
    const corpB = makeCorp({ rdScore: 200, type: "extraction" });
    const sectorA = makeSector(corpA._id, {
      sectorType: "extraction",
      strategyId: "iron_mining",
      stateId: "US-MN",
    });
    const sectorB = makeSector(corpB._id, {
      sectorType: "extraction",
      strategyId: "iron_mining",
      stateId: "US-MN",
    });
    const cap = new Map<string, Partial<Record<ExtractableResource, number>>>();
    cap.set("US-MN", { iron: 500_000 });
    const result = processRdInnovations(
      baseLookups([corpA, corpB], [sectorA, sectorB], { stateResourceCapacity: cap }),
      6,
      now
    );

    expect(result.innovationsTriggered).toBe(2);
    // Two extraction breakthroughs in the same state collapse to a single bulk op.
    // Each adds round(currentCap × MIN_PCT) (Math.random mocked to 0), and the
    // current cap is read from the same pre-turn lookup for both.
    expect(result.capacityBoostOps).toHaveLength(1);
    const op = result.capacityBoostOps[0];
    expect(op.updateOne.update.$inc["resources.iron"]).toBe(
      2 * Math.round(500_000 * RD_CAPACITY_BOOST_MIN_PCT)
    );
  });

  it("skips sending notifications when the CEO slot is vacant", async () => {
    const { createNotifications } = await import("@/lib/notifications");
    const corp = makeCorp({ rdScore: 200, ceoVacant: true });
    const sector = makeSector(corp._id);
    const result = processRdInnovations(baseLookups([corp], [sector]), 6, now);

    expect(result.innovationsTriggered).toBe(1);
    expect(createNotifications).not.toHaveBeenCalled();
  });
});
