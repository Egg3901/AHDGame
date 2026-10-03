import { describe, it, expect } from "vitest";
import {
  COMMODITY_BASE_PRICES,
  canonicalPlantsUnitsForCommodity,
  commodityMixWeight,
  plantsSupplyScaledUnits,
  scaleMeasuredProducedUnits,
  type CommodityType,
} from "@/lib/constants/commodities";
import {
  computeClearingFactors,
  describeClearingBookBreach,
  isClearingBookBreach,
  type ClearingBookDiagnostic,
} from "./clearing";

const bals = (entries: Array<[CommodityType, { supply: number; demand: number }]>) =>
  new Map(entries);

const priceRatios = (entries: Array<[CommodityType, number]>) => new Map(entries);

function diagnostic(
  commodity: CommodityType,
  group: string | null,
  normalizedOfferedUnits: number,
  laggedSupply: number,
  rawOfferedUnits = normalizedOfferedUnits
): ClearingBookDiagnostic {
  return {
    commodity,
    group,
    rawOfferedUnits,
    normalizedOfferedUnits,
    offeredUnits: normalizedOfferedUnits,
    normalizableUnits: 0,
    exemptRealUnits: normalizedOfferedUnits,
    laggedSupply,
    laggedDemand: 0,
    invariantBreach: isClearingBookBreach(normalizedOfferedUnits, laggedSupply),
  };
}

describe("isClearingBookBreach — issue #2054 pinned books", () => {
  it("breaches on fertilizers@FR: 12,139 normalized vs 1,491 lagged (8.1x)", () => {
    expect(isClearingBookBreach(12139, 1491)).toBe(true);
  });

  it("breaches on pharmaceuticals@BR: 2,112 normalized vs effectively zero lagged", () => {
    expect(isClearingBookBreach(2112, 0.17)).toBe(true);
  });

  it("breaches on ordnance@FR: 514 normalized vs effectively zero lagged", () => {
    expect(isClearingBookBreach(514, 0.15)).toBe(true);
  });
});

describe("isClearingBookBreach — clean intervals stay silent", () => {
  it("comparable book and ledger do not breach", () => {
    expect(isClearingBookBreach(1500, 1491)).toBe(false);
    expect(isClearingBookBreach(1000, 1200)).toBe(false);
  });

  it("exactly 2x is growth, not a breach", () => {
    expect(isClearingBookBreach(2000, 1000)).toBe(false);
    expect(isClearingBookBreach(2000.01, 1000)).toBe(true);
  });

  it("a sub-material gap never breaches whatever the ratio", () => {
    expect(isClearingBookBreach(1249, 1000)).toBe(false);
    expect(isClearingBookBreach(30, 0)).toBe(false);
    expect(isClearingBookBreach(200, 0.15)).toBe(false);
  });

  it("non-finite inputs never breach", () => {
    expect(isClearingBookBreach(NaN, 1000)).toBe(false);
    expect(isClearingBookBreach(5000, NaN)).toBe(false);
    expect(isClearingBookBreach(Number.POSITIVE_INFINITY, 1000)).toBe(false);
    expect(isClearingBookBreach(5000, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe("turn-0 commodity price placeholders", () => {
  const baseline = {
    sectors: [
      {
        sectorId: "new-healthcare-plant",
        revenue: 3_255_000,
        supplyRates: { healthcare_services: 1 },
        posture: 0,
        producedUnits: 3_255,
      },
    ],
    balances: bals([["healthcare_services", { supply: 0, demand: 0 }]]),
    priceRatioByCommodity: priceRatios([["healthcare_services", 1]]),
    basePrices: COMMODITY_BASE_PRICES,
    plantsEnabled: true,
  } as const;

  it("does not compare a new producer with the reset's zero placeholder", () => {
    const seen: ClearingBookDiagnostic[] = [];
    computeClearingFactors({
      ...baseline,
      initializedLaggedBooks: new Set<CommodityType>(),
      onBookDiagnostic: (diagnostic) => seen.push(diagnostic),
    });
    expect(seen[0]?.invariantBreach).toBe(false);
  });

  it("still reports the same gap after a market turn established the ledger", () => {
    const seen: ClearingBookDiagnostic[] = [];
    computeClearingFactors({
      ...baseline,
      initializedLaggedBooks: new Set<CommodityType>(["healthcare_services"]),
      onBookDiagnostic: (diagnostic) => seen.push(diagnostic),
    });
    expect(seen[0]?.invariantBreach).toBe(true);
  });
});

describe("describeClearingBookBreach", () => {
  it("is deterministic, so replays cannot duplicate or drop the warning", () => {
    const d = diagnostic("ordnance", "FR", 514, 0.15, 514);
    expect(describeClearingBookBreach(d)).toBe(describeClearingBookBreach(d));
    expect(describeClearingBookBreach(d)).toContain("ordnance@FR");
  });

  it("names the worldwide book without a group suffix", () => {
    const d = diagnostic("fertilizers", null, 12139, 1491);
    expect(describeClearingBookBreach(d)).toContain("fertilizers:");
  });
});

describe("canonical plants basis — normalized/ledger equivalence (issue #2054)", () => {
  const supplyRates = { steel: 1, iron: 1 } as Partial<Record<CommodityType, number>>;
  const basePrices = { steel: 800, iron: 400 } as Record<CommodityType, number>;

  it("scaleMeasuredProducedUnits defaults to the legacy chain when no diversion is fresh", () => {
    expect(scaleMeasuredProducedUnits({ producedUnits: 100, isNatcorp: false })).toBe(
      plantsSupplyScaledUnits({ producedUnits: 100, isNatcorp: false })
    );
  });

  it("scaleMeasuredProducedUnits multiplies the retained arsenal share like the ledger leg", () => {
    const scaled = plantsSupplyScaledUnits({ producedUnits: 100, isNatcorp: false });
    expect(
      scaleMeasuredProducedUnits({
        producedUnits: 100,
        isNatcorp: false,
        militaryRetainedFraction: 0.6,
      })
    ).toBeCloseTo((scaled ?? 0) * 0.6, 10);
  });

  it("scaleMeasuredProducedUnits passes nulls through like the ledger chain", () => {
    expect(scaleMeasuredProducedUnits({ producedUnits: null, isNatcorp: false })).toBeNull();
  });

  it("canonicalPlantsUnitsForCommodity equals the manual chain the ledger applies", () => {
    const producedUnits = 120;
    const militaryRetainedFraction = 0.75;
    for (const commodity of ["steel", "iron"] as CommodityType[]) {
      const expected =
        (plantsSupplyScaledUnits({ producedUnits, isNatcorp: true }) ?? 0) *
        militaryRetainedFraction *
        commodityMixWeight(supplyRates, basePrices, commodity);
      expect(
        canonicalPlantsUnitsForCommodity({
          producedUnits,
          isNatcorp: true,
          militaryRetainedFraction,
          supplyRates,
          basePrices,
          commodity,
        })
      ).toBeCloseTo(expected, 10);
    }
  });

  it("a retained share of zero offers nothing, matching the ledger", () => {
    expect(
      canonicalPlantsUnitsForCommodity({
        producedUnits: 120,
        isNatcorp: false,
        militaryRetainedFraction: 0,
        supplyRates,
        basePrices,
        commodity: "steel",
      })
    ).toBe(0);
  });
});

describe("computeClearingFactors — canonical basis prevents depressed fills (issue #2054)", () => {
  const basePrices = { steel: 800 } as Record<CommodityType, number>;
  const common = {
    balances: bals([["steel", { supply: 100, demand: 60 }]]),
    priceRatioByCommodity: priceRatios([["steel", 1]]),
    basePrices,
    plantsEnabled: true,
  };

  it("a canonical-basis book clears honestly and raises no breach", () => {
    const seen: ClearingBookDiagnostic[] = [];
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "a",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0,
          producedUnits: 100,
        },
      ],
      ...common,
      onBookDiagnostic: (d) => seen.push(d),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.invariantBreach).toBe(false);
    expect(results.get("a")!.soldFraction).toBeCloseTo(0.6, 10);
  });

  it("an overstated exempt book breaches and depresses fills", () => {
    const seen: ClearingBookDiagnostic[] = [];
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "a",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0,
          producedUnits: 800,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 60 }]]),
      priceRatioByCommodity: priceRatios([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
      onBookDiagnostic: (d) => seen.push(d),
    });
    expect(seen[0]!.invariantBreach).toBe(true);
    // Same demand and true supply as the canonical book, but the 8x
    // overstatement dilutes every unit: 60/800 instead of 60/100.
    expect(results.get("a")!.soldFraction).toBeCloseTo(0.075, 10);
  });

  it("reproduces the pinned pharmaceuticals@BR shape end to end", () => {
    const seen: ClearingBookDiagnostic[] = [];
    const pharmaBase = { pharmaceuticals: COMMODITY_BASE_PRICES.pharmaceuticals } as Record<
      CommodityType,
      number
    >;
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "br-plant",
          revenue: 1_000_000,
          supplyRates: { pharmaceuticals: 1 },
          posture: 0,
          producedUnits: 2112,
        },
      ],
      balances: bals([]),
      balancesByGroup: new Map([
        ["BR", new Map([["pharmaceuticals", { supply: 0.17, demand: 50 }]])],
      ]),
      groupBySector: new Map([["br-plant", "BR"]]),
      priceRatioByCommodity: priceRatios([["pharmaceuticals", 1]]),
      basePrices: pharmaBase,
      plantsEnabled: true,
      onBookDiagnostic: (d) => seen.push(d),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.group).toBe("BR");
    expect(seen[0]!.invariantBreach).toBe(true);
    expect(results.get("br-plant")!.soldFraction).toBeLessThan(0.05);
  });
});
