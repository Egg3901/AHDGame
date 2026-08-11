import { describe, it, expect } from "vitest";
import {
  computeRateEnvironmentMultiplier,
  computeLatentFinancialDemand,
  computeMarketPrice,
  computeCommodityMarginModifier,
  computeCommoditySurplusBonus,
  computeBlendedMarginModifiers,
  computeCommoditySummary,
  computeCommodityPressureRatio,
  computeEffectiveCommodityPressureRatio,
  FINANCIAL_NEUTRAL_RATE,
  FINANCIAL_RATE_MULTIPLIER_MIN,
  FINANCIAL_RATE_MULTIPLIER_MAX,
  COMMODITY_BASE_PRICES,
  FINANCIAL_DEMAND_ISSUANCE_FRACTION,
  COMMODITY_TYPES,
  COMMODITY_AGGREGATE_INPUT_CAP,
  COMMODITY_AGGREGATE_SURPLUS_CAP,
  COMMODITY_PRESSURE_SOFT_KNEE,
  computeRawSupplyDemand,
  getCommodityStabilizer,
  UNOWNED_DRIFT_AMPLITUDE,
  extractionOutputScaleFor,
  commodityMixWeight,
  SECTOR_SUPPLY,
} from "./commodities";
import type { CommodityType, GdpGrowthData } from "./commodities";

describe("computeRateEnvironmentMultiplier", () => {
  it("returns 1.0 at neutral rate", () => {
    expect(computeRateEnvironmentMultiplier(FINANCIAL_NEUTRAL_RATE)).toBe(1);
  });

  it("returns > 1 when rate is below neutral (cheap money boosts demand)", () => {
    const multiplier = computeRateEnvironmentMultiplier(1.0);
    expect(multiplier).toBeGreaterThan(1);
  });

  it("returns < 1 when rate is above neutral (expensive money suppresses demand)", () => {
    const multiplier = computeRateEnvironmentMultiplier(5.0);
    expect(multiplier).toBeLessThan(1);
  });

  it("clamps to min at very high rates", () => {
    const multiplier = computeRateEnvironmentMultiplier(20);
    expect(multiplier).toBe(FINANCIAL_RATE_MULTIPLIER_MIN);
  });

  it("clamps to max at very low rates", () => {
    const multiplier = computeRateEnvironmentMultiplier(-5);
    expect(multiplier).toBe(FINANCIAL_RATE_MULTIPLIER_MAX);
  });

  it("returns correct value for US default rate (2.5%)", () => {
    // 2.5 is below neutral 2.75, so demand is slightly boosted
    const multiplier = computeRateEnvironmentMultiplier(2.5);
    expect(multiplier).toBeGreaterThan(1);
    expect(multiplier).toBeLessThan(1.1);
  });
});

describe("computeLatentFinancialDemand", () => {
  it("returns demand proportional to recent debt issuance", () => {
    const stateDebtIssuance = new Map([
      ["CA", 180_000_000_000],
      ["TX", 100_000_000_000],
    ]);

    const result = computeLatentFinancialDemand({
      primeRate: FINANCIAL_NEUTRAL_RATE,
      stateDebtIssuance,
    });

    expect(result.has("CA")).toBe(true);
    expect(result.has("TX")).toBe(true);
    // CA has 1.8x the issuance of TX, so should have 1.8x the demand
    const ratio = result.get("CA")! / result.get("TX")!;
    expect(ratio).toBeCloseTo(1.8, 1);
  });

  it("produces higher demand at lower rates", () => {
    const stateDebtIssuance = new Map([["CA", 150_000_000_000]]);

    const lowRate = computeLatentFinancialDemand({
      primeRate: 1.0,
      stateDebtIssuance,
    });

    const highRate = computeLatentFinancialDemand({
      primeRate: 5.0,
      stateDebtIssuance,
    });

    expect(lowRate.get("CA")!).toBeGreaterThan(highRate.get("CA")!);
  });

  it("produces reasonable unit values for large sovereign issuance", () => {
    const stateDebtIssuance = new Map([["federal", 125_000_000_000]]);
    const result = computeLatentFinancialDemand({
      primeRate: FINANCIAL_NEUTRAL_RATE,
      stateDebtIssuance,
    });

    const units = result.get("federal")!;
    const basePrice = COMMODITY_BASE_PRICES["financial_services"];
    const expected = (125_000_000_000 * FINANCIAL_DEMAND_ISSUANCE_FRACTION) / basePrice;
    expect(units).toBeCloseTo(expected, 0);
  });

  it("returns empty map for empty input", () => {
    const result = computeLatentFinancialDemand({
      primeRate: 2.5,
      stateDebtIssuance: new Map(),
    });
    expect(result.size).toBe(0);
  });
});

describe("computeMarketPrice", () => {
  it("returns the base price when both supply and demand are zero", () => {
    expect(computeMarketPrice(400, 0, 0)).toBe(400);
  });

  it("falls below the old 50% floor under extreme oversupply", () => {
    expect(computeMarketPrice(400, 19_600, 218)).toBeLessThan(200);
  });

  it("rises above the old 2x cap and keeps increasing when zero supply meets more demand", () => {
    const lowDemand = computeMarketPrice(400, 0, 218);
    const highDemand = computeMarketPrice(400, 0, 600);

    expect(lowDemand).toBeGreaterThan(800);
    expect(highDemand).toBeGreaterThan(lowDemand);
  });
});

describe("commodity margin modifiers", () => {
  it("buyer penalties are negative and capped per commodity at ±50%", () => {
    const extremeDemand = new Map<CommodityType, { supply: number; demand: number }>([
      ["building_materials", { supply: 0, demand: 1000 }],
    ]);

    const penalty = computeCommodityMarginModifier("telecommunications", extremeDemand);

    expect(penalty).toBeLessThan(0);
    // Per-commodity cap: extreme shortage is capped at -50
    expect(penalty).toBeGreaterThanOrEqual(-50);
  });

  it("producer penalties are negative and capped per commodity at ±50%", () => {
    const extremeSupply = new Map<CommodityType, { supply: number; demand: number }>([
      ["building_materials", { supply: 10_000, demand: 0 }],
    ]);

    const bonus = computeCommoditySurplusBonus("manufacturing", extremeSupply);

    expect(bonus).toBeLessThan(0);
    // Per-commodity cap: extreme oversupply is capped at -50
    expect(bonus).toBeGreaterThanOrEqual(-50);
  });

  it("moderate imbalances are not capped", () => {
    const moderate = new Map<CommodityType, { supply: number; demand: number }>([
      ["building_materials", { supply: 1000, demand: 2000 }],
    ]);

    const penalty = computeCommodityMarginModifier("telecommunications", moderate);
    // 2× shortage at rate 0.10: -100 × 0.10 × ln(2) ≈ -6.9 — well within cap
    expect(penalty).toBeLessThan(0);
    expect(penalty).toBeGreaterThan(-50);
  });
});

describe("commodity rewiring", () => {
  it("routes service sectors into direct service commodities", () => {
    const rows = computeCommoditySummary([
      { sectorType: "healthcare", revenue: 1_000_000 },
      { sectorType: "real_estate", revenue: 1_000_000 },
      { sectorType: "construction", revenue: 1_000_000 },
      { sectorType: "chemical_industries", revenue: 1_000_000 },
    ]);

    const rowMap = new Map(rows.map((row) => [row.commodity, row]));

    expect(rowMap.get("healthcare_services")?.supply).toBeGreaterThan(0);
    expect(rowMap.get("real_estate_services")?.supply).toBeGreaterThan(0);
    expect(rowMap.get("construction_services")?.supply).toBeGreaterThan(0);
    expect(rowMap.get("chemicals")?.supply).toBeGreaterThan(0);
    expect(rowMap.get("pharmaceuticals")?.demand).toBeGreaterThan(0);
  });
});

// ─── computeCommodityPressureRatio balance guards ─────────────────────────────

describe("computeCommodityPressureRatio", () => {
  it("returns 1 when supply equals demand", () => {
    expect(computeCommodityPressureRatio(1000, 1000)).toBe(1);
  });

  it("returns demand/supply ratio for shortage", () => {
    expect(computeCommodityPressureRatio(100, 300)).toBeCloseTo(3, 5);
  });

  it("returns demand/supply ratio for surplus", () => {
    expect(computeCommodityPressureRatio(300, 100)).toBeCloseTo(1 / 3, 5);
  });

  it("handles zero supply without divide-by-zero", () => {
    expect(() => computeCommodityPressureRatio(0, 500)).not.toThrow();
    expect(computeCommodityPressureRatio(0, 500)).toBeGreaterThan(1);
  });

  it("returns 1 when both sides are zero", () => {
    expect(computeCommodityPressureRatio(0, 0)).toBe(1);
  });
});

// ─── COMMODITY_BASE_PRICES coverage ──────────────────────────────────────────

describe("computeEffectiveCommodityPressureRatio", () => {
  it("leaves pressure unchanged inside the 3x soft-knee", () => {
    expect(computeEffectiveCommodityPressureRatio(100, 200)).toBeCloseTo(2, 5);
    expect(computeEffectiveCommodityPressureRatio(100, 300)).toBeCloseTo(
      COMMODITY_PRESSURE_SOFT_KNEE,
      5
    );
    expect(computeEffectiveCommodityPressureRatio(200, 100)).toBeCloseTo(0.5, 5);
    expect(computeEffectiveCommodityPressureRatio(300, 100)).toBeCloseTo(
      1 / COMMODITY_PRESSURE_SOFT_KNEE,
      5
    );
  });

  it("keeps growing above 3x but with a compressed tail", () => {
    const fiveX = computeEffectiveCommodityPressureRatio(100, 500);
    const tenX = computeEffectiveCommodityPressureRatio(100, 1000);
    const hundredX = computeEffectiveCommodityPressureRatio(100, 10_000);

    expect(fiveX).toBeGreaterThan(COMMODITY_PRESSURE_SOFT_KNEE);
    expect(fiveX).toBeLessThan(5);
    expect(tenX).toBeGreaterThan(fiveX);
    expect(tenX).toBeLessThan(10);
    expect(hundredX).toBeGreaterThan(tenX);
    expect(hundredX).toBeLessThan(100);
  });

  it("compresses shortage and oversupply symmetrically in log space", () => {
    const shortage = computeEffectiveCommodityPressureRatio(100, 1000);
    const surplus = computeEffectiveCommodityPressureRatio(1000, 100);

    expect(shortage * surplus).toBeCloseTo(1, 5);
    expect(surplus).toBeGreaterThan(0.1);
    expect(surplus).toBeLessThan(1 / COMMODITY_PRESSURE_SOFT_KNEE);
  });
});

describe("COMMODITY_BASE_PRICES", () => {
  it("has a positive base price for every commodity type", () => {
    for (const c of COMMODITY_TYPES) {
      expect(COMMODITY_BASE_PRICES[c]).toBeGreaterThan(0);
    }
  });
});

describe("computeBlendedMarginModifiers", () => {
  function bal(
    commodity: CommodityType,
    supply: number,
    demand: number
  ): Map<CommodityType, { supply: number; demand: number }> {
    return new Map([[commodity, { supply, demand }]]);
  }

  it("returns zero modifiers when both levels are balanced", () => {
    const global = bal("steel", 10_000, 10_000);
    const national = bal("steel", 5_000, 5_000);
    const state = bal("steel", 1_000, 1_000);
    const result = computeBlendedMarginModifiers("defense", global, national, state);
    expect(result.inputMod).toBeCloseTo(0, 0);
    expect(result.surplusMod).toBeCloseTo(0, 0);
  });

  it("produces meaningful negative for defense steel at 2x global shortage", () => {
    const global = bal("steel", 15_000, 30_000);
    const national = bal("steel", 7_500, 15_000);
    const state = bal("steel", 500, 1_000);
    const result = computeBlendedMarginModifiers("defense", global, national, state);
    // K=50, rate=0.25: global ratio 2.0 → ~-8.7%, state adds more
    expect(result.inputMod).toBeLessThan(-5);
  });

  it("state shortage amplifies global signal", () => {
    const global = bal("steel", 30_000, 30_000);
    const national = bal("steel", 12_000, 12_000);
    const state = bal("steel", 100, 1_000);
    const result = computeBlendedMarginModifiers("defense", global, national, state);
    // Global balanced → 0, state 10× shortage contributes via 25% weight
    expect(result.inputMod).toBeLessThan(-2);
  });

  it("state stabilizer prevents extreme ratios with zero local supply", () => {
    const global = bal("steel", 30_000, 30_000);
    const national = bal("steel", 12_000, 12_000);
    const state = bal("steel", 0, 1_000);
    const result = computeBlendedMarginModifiers("defense", global, national, state);
    expect(result.inputMod).toBeLessThan(-2);
    expect(result.inputMod).toBeGreaterThan(-15);
  });

  it("applies retail penalty factor to blended input mod", () => {
    const global = bal("electronics", 5_000, 10_000);
    const national = bal("electronics", 5_000, 10_000);
    const state = bal("electronics", 200, 500);
    const retailResult = computeBlendedMarginModifiers("retail", global, national, state);
    const mediaResult = computeBlendedMarginModifiers("media", global, national, state);
    expect(retailResult.inputMod).toBeLessThan(0);
    expect(Math.abs(retailResult.inputMod)).toBeLessThan(Math.abs(mediaResult.inputMod) * 0.5);
  });

  it("surplus bonus is positive when sellers face shortage", () => {
    const global = bal("steel", 10_000, 20_000);
    const national = bal("steel", 6_000, 12_000);
    const state = bal("steel", 500, 1_000);
    const result = computeBlendedMarginModifiers("manufacturing", global, national, state);
    expect(result.surplusMod).toBeGreaterThan(10);
  });
});

// ─── Phase 1: Aggregate cap guards ───────────────────────────────────────────
// These tests verify the COMMODITY_AGGREGATE_INPUT_CAP and COMMODITY_AGGREGATE_SURPLUS_CAP
// behaviour added in Phase 1 of the commodity balance plan.

describe("aggregate commodity caps (Phase 1)", () => {
  /** Build a balanced map for all commodities then override specific ones */
  function makeBalances(
    overrides: Partial<Record<CommodityType, { supply: number; demand: number }>>
  ): Map<CommodityType, { supply: number; demand: number }> {
    const m = new Map<CommodityType, { supply: number; demand: number }>();
    for (const c of COMMODITY_TYPES) {
      m.set(c, { supply: 1000, demand: 1000 });
    }
    for (const [c, v] of Object.entries(overrides)) {
      m.set(c as CommodityType, v as { supply: number; demand: number });
    }
    return m;
  }

  it("energy sector: stacked 5× shortage on oil/coal/copper/natural_gas does not exceed aggregate input cap", () => {
    const scarce = makeBalances({
      oil: { supply: 100, demand: 500 },
      coal: { supply: 100, demand: 500 },
      rare_earth: { supply: 100, demand: 500 },
      natural_gas: { supply: 100, demand: 500 },
      steel: { supply: 100, demand: 500 },
    });
    const { inputMod } = computeBlendedMarginModifiers("energy", scarce, scarce, scarce);
    expect(inputMod).toBeGreaterThanOrEqual(-COMMODITY_AGGREGATE_INPUT_CAP);
  });

  it("automobiles sector: stacked 5× shortage on all inputs does not exceed aggregate input cap", () => {
    const scarce = makeBalances({
      steel: { supply: 100, demand: 500 },
      iron: { supply: 100, demand: 500 },
      electronics: { supply: 100, demand: 500 },
      rare_earth: { supply: 100, demand: 500 },
      plastics: { supply: 100, demand: 500 },
    });
    const { inputMod } = computeBlendedMarginModifiers("automobiles", scarce, scarce, scarce);
    expect(inputMod).toBeGreaterThanOrEqual(-COMMODITY_AGGREGATE_INPUT_CAP);
  });

  it("extraction sector: diversified strategy 5× shortage on all outputs does not exceed surplus cap", () => {
    const scarce = makeBalances({
      iron: { supply: 100, demand: 500 },
      oil: { supply: 100, demand: 500 },
      coal: { supply: 100, demand: 500 },
      rare_earth: { supply: 100, demand: 500 },
      natural_gas: { supply: 100, demand: 500 },
      timber: { supply: 100, demand: 500 },
    });
    const { surplusMod } = computeBlendedMarginModifiers("extraction", scarce, scarce, scarce);
    expect(surplusMod).toBeLessThanOrEqual(COMMODITY_AGGREGATE_SURPLUS_CAP);
  });

  it("construction sector: stacked shortage does not collapse below aggregate cap", () => {
    const scarce = makeBalances({
      building_materials: { supply: 100, demand: 500 },
      steel: { supply: 100, demand: 500 },
      rare_earth: { supply: 100, demand: 500 },
      timber: { supply: 100, demand: 500 },
      plastics: { supply: 100, demand: 500 },
      natural_gas: { supply: 100, demand: 500 },
    });
    const { inputMod } = computeBlendedMarginModifiers("construction", scarce, scarce, scarce);
    expect(inputMod).toBeGreaterThanOrEqual(-COMMODITY_AGGREGATE_INPUT_CAP);
  });

  it("moderate shortages (1.5×) are not capped — cap only kicks in at extremes", () => {
    const moderate = makeBalances({
      steel: { supply: 100, demand: 150 },
      iron: { supply: 100, demand: 150 },
      electronics: { supply: 100, demand: 150 },
    });
    const { inputMod } = computeBlendedMarginModifiers("automobiles", moderate, moderate, moderate);
    // Should be a real negative value, not zero — cap doesn't flatten moderate pressure
    expect(inputMod).toBeLessThan(-1);
    expect(inputMod).toBeGreaterThan(-15);
  });
});

describe("computeRawSupplyDemand — state-owned (NatCorp) sectors", () => {
  // Bug #0775: nationalizing a commodity producer collapsed national supply because
  // NatCorp sectors were scaled to 0.25% of their commodity flow. A nationalized
  // energy company must supply (and consume) like any private producer.
  it("a NatCorp producer contributes the same commodity supply as an identical private one", () => {
    const base = { sectorType: "energy", revenue: 1_000_000 };
    const priv = computeRawSupplyDemand([{ ...base, stateId: "PRIV" }]);
    const nat = computeRawSupplyDemand([{ ...base, stateId: "NAT", isNatcorp: true }]);

    const privSupply = priv.byState.get("PRIV")?.get("energy")?.supply ?? 0;
    const natSupply = nat.byState.get("NAT")?.get("energy")?.supply ?? 0;

    expect(privSupply).toBeGreaterThan(0);
    expect(natSupply).toBeCloseTo(privSupply, 6);
  });

  it("a NatCorp producer's input demand also matches an identical private one", () => {
    const sumDemand = (res: ReturnType<typeof computeRawSupplyDemand>, stateId: string): number => {
      let total = 0;
      const m = res.byState.get(stateId);
      if (m) for (const v of m.values()) total += v.demand;
      return total;
    };
    const base = { sectorType: "manufacturing", revenue: 1_000_000 };
    const priv = computeRawSupplyDemand([{ ...base, stateId: "PRIV" }]);
    const nat = computeRawSupplyDemand([{ ...base, stateId: "NAT", isNatcorp: true }]);

    const privDemand = sumDemand(priv, "PRIV");
    const natDemand = sumDemand(nat, "NAT");

    expect(privDemand).toBeGreaterThan(0);
    expect(natDemand).toBeCloseTo(privDemand, 6);
  });
});

describe("computeRawSupplyDemand — sectorDemandModifierPct (World Events v1 Phase 1)", () => {
  it("is a pure no-op when the map is omitted (existing callers unaffected)", () => {
    const sector = {
      sectorType: "entertainment",
      revenue: 1_000_000,
      stateId: "S1",
      countryId: "UK",
    };
    const withoutMap = computeRawSupplyDemand([sector]);
    const withEmptyMap = computeRawSupplyDemand(
      [sector],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      new Map()
    );
    const a = withoutMap.byState.get("S1")?.get("software")?.demand ?? 0;
    const b = withEmptyMap.byState.get("S1")?.get("software")?.demand ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(a, 6);
  });

  it("scales a matching sector's demand contribution by the modifier pct (royal-event tourism bump)", () => {
    const sector = {
      sectorType: "entertainment",
      revenue: 1_000_000,
      stateId: "S1",
      countryId: "UK",
    };
    const baseline = computeRawSupplyDemand([sector]);
    const boosted = computeRawSupplyDemand(
      [sector],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      new Map([["UK:entertainment", 5]])
    );

    const baseDemand = baseline.byState.get("S1")?.get("software")?.demand ?? 0;
    const boostedDemand = boosted.byState.get("S1")?.get("software")?.demand ?? 0;

    expect(baseDemand).toBeGreaterThan(0);
    expect(boostedDemand).toBeCloseTo(baseDemand * 1.05, 6);
  });

  it("only affects the matching country — a modifier for UK does not touch a US sector of the same type", () => {
    const sector = {
      sectorType: "entertainment",
      revenue: 1_000_000,
      stateId: "S1",
      countryId: "US",
    };
    const baseline = computeRawSupplyDemand([sector]);
    const withUkModifier = computeRawSupplyDemand(
      [sector],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      new Map([["UK:entertainment", 5]])
    );

    const baseDemand = baseline.byState.get("S1")?.get("software")?.demand ?? 0;
    const unaffectedDemand = withUkModifier.byState.get("S1")?.get("software")?.demand ?? 0;
    expect(unaffectedDemand).toBeCloseTo(baseDemand, 6);
  });

  it("only affects the matching sectorType — a modifier for entertainment does not touch energy", () => {
    const sector = { sectorType: "energy", revenue: 1_000_000, stateId: "S1", countryId: "UK" };
    const baseline = computeRawSupplyDemand([sector]);
    const withEntertainmentModifier = computeRawSupplyDemand(
      [sector],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      new Map([["UK:entertainment", 50]])
    );
    const sumDemand = (res: ReturnType<typeof computeRawSupplyDemand>): number => {
      let total = 0;
      const m = res.byState.get("S1");
      if (m) for (const v of m.values()) total += v.demand;
      return total;
    };
    expect(sumDemand(withEntertainmentModifier)).toBeCloseTo(sumDemand(baseline), 6);
  });

  it("has no effect when the sector has no countryId (older callers that don't thread it)", () => {
    const sector = { sectorType: "entertainment", revenue: 1_000_000, stateId: "S1" };
    const baseline = computeRawSupplyDemand([sector]);
    const withMap = computeRawSupplyDemand(
      [sector],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      new Map([["UK:entertainment", 50]])
    );
    const baseDemand = baseline.byState.get("S1")?.get("software")?.demand ?? 0;
    const withMapDemand = withMap.byState.get("S1")?.get("software")?.demand ?? 0;
    expect(withMapDemand).toBeCloseTo(baseDemand, 6);
  });
});

describe("extraction output scale (audit t873)", () => {
  const extraction = { sectorType: "extraction", revenue: 1_000_000, stateId: "S1" };
  const withScale = (
    sectors: Parameters<typeof computeRawSupplyDemand>[0]
  ): ReturnType<typeof computeRawSupplyDemand> =>
    computeRawSupplyDemand(sectors, undefined, undefined, undefined, undefined, undefined, true);

  it("extractionOutputScaleFor is inert when disabled, per-resource when enabled", () => {
    expect(extractionOutputScaleFor("rare_earth", false)).toBe(1);
    expect(extractionOutputScaleFor("rare_earth", true)).toBe(2.5);
    expect(extractionOutputScaleFor("iron", true)).toBe(1.8);
    // coal is omitted (near-balanced) and non-extractables never scale
    expect(extractionOutputScaleFor("coal", true)).toBe(1);
    expect(extractionOutputScaleFor("steel", true)).toBe(1);
  });

  it("scales extraction copper supply by the multiplier only when enabled", () => {
    const off = computeRawSupplyDemand([extraction]);
    const on = withScale([extraction]);
    const offSupply = off.byState.get("S1")?.get("rare_earth")?.supply ?? 0;
    const onSupply = on.byState.get("S1")?.get("rare_earth")?.supply ?? 0;
    expect(offSupply).toBeGreaterThan(0);
    expect(onSupply).toBeCloseTo(offSupply * 2.5, 6);
  });

  it("leaves omitted (coal) and non-extraction supply untouched", () => {
    const coalOff =
      computeRawSupplyDemand([extraction]).byState.get("S1")?.get("coal")?.supply ?? 0;
    const coalOn = withScale([extraction]).byState.get("S1")?.get("coal")?.supply ?? 0;
    expect(coalOff).toBeGreaterThan(0);
    expect(coalOn).toBeCloseTo(coalOff, 6);

    const mfg = { sectorType: "manufacturing", revenue: 1_000_000, stateId: "M1" };
    const mOff = computeRawSupplyDemand([mfg]).byState.get("M1")?.get("steel")?.supply ?? 0;
    const mOn = withScale([mfg]).byState.get("M1")?.get("steel")?.supply ?? 0;
    expect(mOff).toBeGreaterThan(0);
    expect(mOn).toBeCloseTo(mOff, 6);
  });
});

describe("computeRawSupplyDemand — unowned commodity drift (sandbox-seed-audit-t101)", () => {
  // A commodity nothing produces or consumes previously sat at exactly
  // `supply === demand === stabilizer` for every turn forever — 9 of 28
  // seeded commodities showed exactly 0.000% price deviation after 101 turns
  // in the sandbox audit. The bounded drift term should break that.
  it("supply and demand diverge from the stabilizer once a turn number is provided", () => {
    const frozen = computeRawSupplyDemand([]); // no currentTurn -> no drift
    const drifting = computeRawSupplyDemand([], undefined, undefined, 17); // currentTurn = 17

    const stab = getCommodityStabilizer("rare_earth");
    const frozenCopper = frozen.global.get("rare_earth")!;
    const driftingCopper = drifting.global.get("rare_earth")!;

    expect(frozenCopper.supply).toBe(stab);
    expect(frozenCopper.demand).toBe(stab);

    // At least one side should have moved off the stabilizer, and supply
    // should not equal demand (the whole point — a real ratio to price off).
    expect(driftingCopper.supply === stab && driftingCopper.demand === stab).toBe(false);
    expect(driftingCopper.supply).not.toBeCloseTo(driftingCopper.demand, 6);
  });

  it("stays within the bounded drift amplitude and is deterministic per turn", () => {
    const stab = getCommodityStabilizer("rare_earth");
    const maxDelta = stab * UNOWNED_DRIFT_AMPLITUDE;

    const a = computeRawSupplyDemand([], undefined, undefined, 5).global.get("rare_earth")!;
    const b = computeRawSupplyDemand([], undefined, undefined, 5).global.get("rare_earth")!;

    expect(a).toEqual(b); // deterministic, not random noise
    expect(Math.abs(a.supply - stab)).toBeLessThanOrEqual(maxDelta + 1e-9);
    expect(Math.abs(a.demand - stab)).toBeLessThanOrEqual(maxDelta + 1e-9);
  });

  it("does not perturb a commodity with real sector activity in any meaningful way", () => {
    // The drift term is sized off the commodity's own stabilizer, not its
    // accumulated supply/demand — so a commodity with large real activity
    // should see a negligible relative change, not fresh noise on top.
    const sectors = [{ sectorType: "energy", revenue: 50_000_000, stateId: "TX" }];
    const noDrift = computeRawSupplyDemand(sectors);
    const withDrift = computeRawSupplyDemand(sectors, undefined, undefined, 5);

    const before = noDrift.global.get("energy")!;
    const after = withDrift.global.get("energy")!;
    const relativeChange = Math.abs(after.supply - before.supply) / before.supply;
    expect(relativeChange).toBeLessThan(0.01);
  });
});

describe("computeRawSupplyDemand — suppressRetailConsumerDemand (Household Ledger consolidation)", () => {
  const retail = { sectorType: "retail", revenue: 1_000_000, stateId: "S1" };
  const gdp: GdpGrowthData = { nationalAverage: 0, byState: new Map([["S1", 0]]) };
  // positional args: (sectors, gdp, stateGdpMap, turn, primeRates, extractionMult, extractionScale, sectorDemandMod, suppress)
  const withSuppress = (on: boolean) =>
    computeRawSupplyDemand(
      [retail],
      gdp,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      on
    );

  it("removes retail's input demand when suppressed, but keeps the retail self-loop", () => {
    const on = withSuppress(false);
    const off = withSuppress(true);
    // A1: retail's consumer-input demand (e.g. food) is present without suppression, gone with it
    expect(on.global.get("food")!.demand).toBeGreaterThan(off.global.get("food")!.demand);
    // A2: retail-commodity self-loop stays — household population demand cannot
    // replace plants-scale physical retail supply (ticket #1026).
    expect(off.global.get("retail")!.demand).toBe(on.global.get("retail")!.demand);
    // At 0% GDP growth the self-loop sets demand ≈ supply (plus equal stabilizers).
    expect(off.global.get("retail")!.demand).toBeCloseTo(off.global.get("retail")!.supply, 6);
    // Supply side is untouched
    expect(off.global.get("retail")!.supply).toBe(on.global.get("retail")!.supply);
    expect(off.global.get("retail")!.supply).toBeGreaterThan(0);
  });

  it("self-loop keeps retail near balance under plants-scale physical supply (ticket #1026)", () => {
    // Reproduce the live failure mode: huge physical retail offer + household
    // flag on (input proxy suppressed) must NOT leave retail massively long.
    const plantsRetail = {
      sectorType: "retail" as const,
      revenue: 50_000,
      stateId: "S1",
      producedUnits: 8_300_000,
      capacityUnits: 8_300_000,
    };
    const { global } = computeRawSupplyDemand(
      [plantsRetail],
      gdp,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      true, // household on → suppress retail INPUT proxy only
      true // plants ledger
    );
    const bal = global.get("retail")!;
    // Self-loop at 0% GDP growth adds demand ≈ supply; ratio must stay near 1,
    // not the ~169× oversupply seen on prod turn 16.
    const ratio = bal.supply / Math.max(1, bal.demand);
    expect(ratio).toBeLessThan(2);
    expect(bal.demand).toBeGreaterThan(bal.supply * 0.5);
  });

  it("is a no-op for non-retail sectors", () => {
    const agri = { sectorType: "agriculture", revenue: 1_000_000, stateId: "S1" };
    const on = computeRawSupplyDemand(
      [agri],
      gdp,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false
    );
    const off = computeRawSupplyDemand(
      [agri],
      gdp,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      true
    );
    expect(off.global.get("food")!.supply).toBe(on.global.get("food")!.supply);
    expect(off.global.get("food")!.demand).toBe(on.global.get("food")!.demand);
  });
});

describe("computeRawSupplyDemand — plants tier (real production, P3b)", () => {
  const plants = (
    sectors: Parameters<typeof computeRawSupplyDemand>[0]
  ): ReturnType<typeof computeRawSupplyDemand> =>
    computeRawSupplyDemand(
      sectors,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      true
    );
  const sumDemand = (res: ReturnType<typeof computeRawSupplyDemand>, stateId: string): number => {
    let total = 0;
    const m = res.byState.get(stateId);
    if (m) for (const v of m.values()) total += v.demand;
    return total;
  };

  it("is a pure no-op when plantsEnabled is off, even with producedUnits supplied", () => {
    const sector = {
      sectorType: "manufacturing",
      revenue: 1_000_000,
      stateId: "S1",
      producedUnits: 1,
      capacityUnits: 1_000_000,
      mothballed: true,
    };
    const off = computeRawSupplyDemand([sector]);
    const legacy = computeRawSupplyDemand([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1" },
    ]);
    for (const c of off.byState.get("S1")!.keys()) {
      expect(off.byState.get("S1")!.get(c)!.supply).toBeCloseTo(
        legacy.byState.get("S1")!.get(c)!.supply,
        6
      );
      expect(off.byState.get("S1")!.get(c)!.demand).toBeCloseTo(
        legacy.byState.get("S1")!.get(c)!.demand,
        6
      );
    }
  });

  it("supply comes from producedUnits, not the revenue nameplate", () => {
    const nameplate = plants([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1" },
    ]).byState.get("S1")!;
    // A plant running at HALF its nameplate: production is measured, not derived.
    const full = plants([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1", producedUnits: 1000 },
    ]).byState.get("S1")!;
    const half = plants([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1", producedUnits: 500 },
    ]).byState.get("S1")!;
    let sawOutput = false;
    for (const [c, v] of full) {
      if (v.supply <= 0) continue;
      sawOutput = true;
      // Halving production halves supply for every output commodity...
      expect(half.get(c)!.supply).toBeCloseTo(v.supply / 2, 6);
      // ...and the total no longer tracks the (unchanged) revenue nameplate.
      expect(v.supply).toBeGreaterThan(0);
    }
    expect(sawOutput).toBe(true);
    // The nameplate derivation is no longer what determines the total.
    let nameplateTotal = 0;
    let halfTotal = 0;
    for (const [, v] of nameplate) nameplateTotal += v.supply;
    for (const [, v] of half) halfTotal += v.supply;
    expect(halfTotal).toBeCloseTo(500, 4);
    expect(halfTotal).toBeLessThan(nameplateTotal);
  });

  it("splits producedUnits across a multi-output mix by the shared mix weights", () => {
    const produced = 1000;
    const res = plants([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1", producedUnits: produced },
    ]).byState.get("S1")!;
    const rates: Partial<Record<CommodityType, number>> = {};
    for (const f of SECTOR_SUPPLY["manufacturing"] ?? []) rates[f.commodity] = f.rate;
    for (const [commodity, rate] of Object.entries(rates) as [CommodityType, number][]) {
      if (!(rate > 0)) continue;
      expect(res.get(commodity)!.supply).toBeCloseTo(
        produced * commodityMixWeight(rates, COMMODITY_BASE_PRICES, commodity),
        6
      );
    }
    // Mix weights sum to 1, so the split conserves the produced total.
    let totalSplit = 0;
    for (const [commodity] of Object.entries(rates) as [CommodityType, number][]) {
      totalSplit += res.get(commodity)!.supply;
    }
    expect(totalSplit).toBeCloseTo(produced, 4);
  });

  it("input demand scales with capacity utilization, not nameplate", () => {
    const fullRun = plants([
      {
        sectorType: "manufacturing",
        revenue: 1_000_000,
        stateId: "S1",
        producedUnits: 1000,
        capacityUnits: 1000,
      },
    ]);
    const throttled = plants([
      {
        sectorType: "manufacturing",
        revenue: 1_000_000,
        stateId: "S1",
        producedUnits: 400,
        capacityUnits: 1000,
      },
    ]);
    expect(sumDemand(fullRun, "S1")).toBeGreaterThan(0);
    expect(sumDemand(throttled, "S1")).toBeCloseTo(sumDemand(fullRun, "S1") * 0.4, 4);
  });

  it("a mothballed plant supplies nothing AND demands nothing (P3a residual)", () => {
    const cold = plants([
      {
        sectorType: "manufacturing",
        revenue: 1_000_000,
        stateId: "S1",
        producedUnits: 0,
        capacityUnits: 1000,
        mothballed: true,
      },
    ]);
    let supply = 0;
    for (const v of cold.byState.get("S1")!.values()) supply += v.supply;
    expect(supply).toBe(0);
    expect(sumDemand(cold, "S1")).toBe(0);
  });

  it("an embargoed plant's supply is scaled by the same factor its revenue is", () => {
    const open = plants([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1", producedUnits: 1000 },
    ]).byState.get("S1")!;
    const embargoed = plants([
      {
        sectorType: "manufacturing",
        revenue: 1_000_000,
        stateId: "S1",
        producedUnits: 1000,
        embargoSupplyFactor: 0.7,
      },
    ]).byState.get("S1")!;
    for (const [c, v] of open) {
      if (v.supply <= 0) continue;
      expect(embargoed.get(c)!.supply).toBeCloseTo(v.supply * 0.7, 6);
    }
    // Symmetry stops at supply: the plant still runs, so it still buys inputs.
    const openDemand = sumDemand(
      plants([
        { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1", producedUnits: 1000 },
      ]),
      "S1"
    );
    const embargoedDemand = sumDemand(
      plants([
        {
          sectorType: "manufacturing",
          revenue: 1_000_000,
          stateId: "S1",
          producedUnits: 1000,
          embargoSupplyFactor: 0.7,
        },
      ]),
      "S1"
    );
    expect(embargoedDemand).toBeCloseTo(openDemand, 6);
  });

  it("falls back to the legacy derivation on a sector's first plants turn", () => {
    const noUnits = plants([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1" },
    ]).byState.get("S1")!;
    const legacy = computeRawSupplyDemand([
      { sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1" },
    ]).byState.get("S1")!;
    for (const [c, v] of noUnits) {
      expect(v.supply).toBeCloseTo(legacy.get(c)!.supply, 6);
      expect(v.demand).toBeCloseTo(legacy.get(c)!.demand, 6);
    }
  });
});

describe("plants extraction supply vs depletion (H2 — two sectors)", () => {
  // Extraction is deliberately EXCLUDED from the `producedUnits` supply override
  // (its rationing multipliers are applied inside computeRawSupplyDemand and
  // `producedUnits` already carries its own capacity haircut, so routing it
  // through the override would double-count the haircut). The residual defect
  // that exclusion left behind is an ASYMMETRY against the depletion booking in
  // `commodityPriceTurn.bookExtractionDepletion`, which charges the state's
  // reserves at `nameplate × rationing × realizedFraction`. The supply ledger was
  // still counting `nameplate × rationing` — the pre-ramp, pre-throughput figure.
  // Extraction is the world's dominant commodity supplier, so the world got goods
  // it never made while the ground was debited only for the real output.
  //
  // Two sectors, identical in every way except how much they actually produced.
  const plants = (
    sectors: Parameters<typeof computeRawSupplyDemand>[0]
  ): ReturnType<typeof computeRawSupplyDemand> =>
    computeRawSupplyDemand(
      sectors,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      true
    );

  const rare = (res: ReturnType<typeof computeRawSupplyDemand>, stateId: string): number =>
    res.byState.get(stateId)?.get("rare_earth")?.supply ?? 0;

  it("a half-producing field supplies half of a full-producing identical field", () => {
    const res = plants([
      // FULL: ran at nameplate, so its realized fraction is 1.
      {
        sectorType: "extraction",
        revenue: 1_000_000,
        stateId: "FULL",
        extractionRealizedFraction: 1,
      },
      // HALF: same revenue nameplate, but only made half of it (ramping, or
      // throughput-limited). Same fraction the depletion booking uses.
      {
        sectorType: "extraction",
        revenue: 1_000_000,
        stateId: "HALF",
        extractionRealizedFraction: 0.5,
      },
    ]);
    expect(rare(res, "FULL")).toBeGreaterThan(0);
    expect(rare(res, "HALF")).toBeCloseTo(rare(res, "FULL") * 0.5, 6);
  });

  it("a fraction of 0 (mothballed / never ran) supplies nothing at all", () => {
    const res = plants([
      {
        sectorType: "extraction",
        revenue: 1_000_000,
        stateId: "COLD",
        extractionRealizedFraction: 0,
      },
    ]);
    // Reserves are likewise debited nothing for it — `bookExtractionDepletion`
    // reads the same 0, which is the whole point of sharing the fraction. A cold
    // field must neither supply goods nor drain the deposit.
    expect(rare(res, "COLD")).toBe(0);
  });

  it("an absent fraction is the pre-plants nameplate — no double-count, no zero-count", () => {
    const withFraction = plants([
      {
        sectorType: "extraction",
        revenue: 1_000_000,
        stateId: "A",
        extractionRealizedFraction: 1,
      },
    ]);
    const withoutFraction = plants([
      { sectorType: "extraction", revenue: 1_000_000, stateId: "B" },
    ]);
    const legacy = computeRawSupplyDemand([
      { sectorType: "extraction", revenue: 1_000_000, stateId: "C" },
    ]);
    expect(rare(withoutFraction, "B")).toBeCloseTo(rare(withFraction, "A"), 6);
    expect(rare(withoutFraction, "B")).toBeCloseTo(rare(legacy, "C"), 6);
  });
});

describe("computeRawSupplyDemand — defence output sold to the state", () => {
  // A plant under a procurement contract ships materiel to an arsenal and is paid per lot.
  // That output must not ALSO reach the market, or one plant's production is paid for twice.
  const plant = (militaryDivertedFraction?: number) => ({
    sectorType: "defense",
    stateId: "TX",
    revenue: 1_000_000,
    strategyId: "munitions",
    militaryDivertedFraction,
  });

  const supplyOf = (res: ReturnType<typeof computeRawSupplyDemand>) => {
    let total = 0;
    const m = res.byState.get("TX");
    if (m) for (const v of m.values()) total += v.supply;
    return total;
  };

  it("removes exactly the diverted share from world supply", () => {
    const full = supplyOf(computeRawSupplyDemand([plant()]));
    const half = supplyOf(computeRawSupplyDemand([plant(0.5)]));
    expect(full).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full / 2, 6);
  });

  it("a plant delivering its whole output supplies the market with nothing", () => {
    expect(supplyOf(computeRawSupplyDemand([plant(1)]))).toBeCloseTo(0, 6);
  });

  // The field is absent on every sector that has never held a contract, and on every
  // non-defence sector in the game — it must be a pure no-op there.
  it("is inert when absent, or zero", () => {
    const none = supplyOf(computeRawSupplyDemand([plant()]));
    expect(supplyOf(computeRawSupplyDemand([plant(0)]))).toBeCloseTo(none, 6);
  });

  it("never inverts into free supply on a corrupt value", () => {
    expect(supplyOf(computeRawSupplyDemand([plant(4)]))).toBeCloseTo(0, 6);
    const none = supplyOf(computeRawSupplyDemand([plant()]));
    expect(supplyOf(computeRawSupplyDemand([plant(-3)]))).toBeCloseTo(none, 6);
  });
});
