import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { resolvePlantsRevenue, type PlantsRevenueInput } from "./plantsRevenue";
import { CAPACITY_BINDING_THRESHOLD } from "@/lib/extraction/capacityHaircut";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

const CURRENT_TURN = 1000;
const GOVERNOR_RAMP_TURNS = 240;
const GOVERNOR_CAP = 0.15;
/** Daily nameplate; the hourly baseline is this / 24 with every leg at 1. */
const PRE_FLIP_REVENUE = 240_000;
const BASELINE_HOURLY = PRE_FLIP_REVENUE / TURNS_PER_DAY;

function input(over: Partial<PlantsRevenueInput> = {}): PlantsRevenueInput {
  const sectorId = new ObjectId();
  const corpId = new ObjectId();
  return {
    sector: {
      _id: sectorId,
      sectorType: "manufacturing",
      countryId: "US",
      stateId: "US-CA",
      soldUnits: undefined,
      producedUnits: undefined,
      capacityUtilization: undefined,
      militaryDivertedFraction: 0,
      militaryDivertedTurn: undefined,
    } as PlantsRevenueInput["sector"],
    corp: { _id: corpId, countryId: "US", bankCharter: undefined } as PlantsRevenueInput["corp"],
    strategySupply: {},
    techEffects: { outputRateMult: {}, priceRealizationBonus: 0 },
    plantsEnabled: true,
    mothballed: false,
    nameplateUnits: 1000,
    activeFraction: 1,
    plantsRampLambda: 1,
    capacityUtil: { utilization: 1, bindingResource: null },
    capacityHaircut: 1,
    capitalFactor: 1,
    capacityHaircutStartTurn: undefined,
    clearing: undefined,
    clearingEnabled: false,
    clearingFactor: 1,
    clearingStartTurn: undefined,
    priceRealization: 1,
    priceRatioByCommodity: new Map(),
    embargoLegacyMothball: false,
    embargoTradeExposureActive: false,
    exportIntensityByCountry: new Map(),
    preFlipNameplateRevenue: PRE_FLIP_REVENUE,
    plantsNameplateRevenue: PRE_FLIP_REVENUE,
    revenueMultiplier: 1,
    nationalizationTransition: 1,
    throughputFactor: 1,
    labourOutputFactor: 1,
    strategyIsTransitioning: false,
    retoolCapacityRatio: 1,
    priorProductionUnitRatio: 1,
    disasterOutputFactor: 1,
    newPolicyLevel: 0,
    plantsCapacity: 1000,
    plantsMixPrice: 10,
    plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS,
    currentTurn: CURRENT_TURN,
    governorCap: GOVERNOR_CAP,
    governorRampTurns: GOVERNOR_RAMP_TURNS,
    privateBankingEnabled: false,
    marketPlantsEnabled: false,
    contractProductionTargetBySectorId: undefined,
    ...over,
  };
}

describe("resolvePlantsRevenue — governor bounds + P3b legs (#588)", () => {
  // D12: a mothballed sector earns exactly 0, even mid-ramp where the general
  // rule would blend it part-way toward its running baseline.
  it("earns exactly 0 when mothballed", () => {
    const r = resolvePlantsRevenue(input({ mothballed: true, plantsStartTurn: CURRENT_TURN }));
    expect(r.marketHourlyRevenue).toBe(0);
    expect(r.hourlyRevenue).toBe(0);
  });

  it("closes a no-buyer mine's deposit ramp with the phase-out, not the launch ramp", () => {
    const deadMine = (noBuyerPhaseOut: number) =>
      resolvePlantsRevenue(
        input({
          sector: {
            ...input().sector,
            sectorType: "extraction",
          } as PlantsRevenueInput["sector"],
          plantsRampLambda: 0.68,
          capacityUtil: { utilization: 0, bindingResource: "rare_earth" },
          noBuyerPhaseOut,
        })
      );
    // Mid launch ramp a zero-deposit mine still produced 32% of capacity.
    expect(deadMine(0).producedUnits).toBeCloseTo(320);
    expect(deadMine(0.84).producedUnits).toBeCloseTo(160);
    expect(deadMine(1).producedUnits).toBe(0);
    expect(deadMine(1).marketHourlyRevenue).toBe(0);
  });

  it("returns the counterfactual baseline untouched when plants are off", () => {
    const r = resolvePlantsRevenue(input({ plantsEnabled: false }));
    expect(r.marketHourlyRevenue).toBe(BASELINE_HOURLY);
    expect(r.hourlyRevenue).toBe(BASELINE_HOURLY);
  });

  // Launch-safety governor: λ = 0 on the flip turn returns the baseline
  // exactly, so a sector arriving with headroom does not jump on day one.
  it("returns the baseline exactly on the flip turn", () => {
    const r = resolvePlantsRevenue(input({ plantsStartTurn: CURRENT_TURN }));
    expect(r.marketHourlyRevenue).toBe(r.baselineHourlyRevenue);
    expect(r.baselineHourlyRevenue).toBe(BASELINE_HOURLY);
    // And the derived leg genuinely differs, so the clamp is doing work.
    expect(r.plantsDerivedHourlyRevenue).not.toBe(BASELINE_HOURLY);
  });

  // C5: the amount variant takes zero literally — a halted sector lands on 0
  // at full ramp, not on its full baseline.
  it("passes a zero baseline through to the derived value, not the reverse", () => {
    const r = resolvePlantsRevenue(input({ preFlipNameplateRevenue: 0 }));
    expect(r.baselineHourlyRevenue).toBe(0);
    expect(r.producedUnits).toBeGreaterThan(0);
    expect(r.marketHourlyRevenue).toBe(r.plantsDerivedHourlyRevenue);
    expect(r.marketHourlyRevenue).toBeGreaterThan(0);
  });

  // The governor binds the BLENDED deviation to ±cap at mid-ramp
  // (λ · cap/(1−λ) = cap at λ = 0.5) and releases it entirely at full ramp,
  // where the physical result stands on its own.
  it("clamps derived revenue to the governor band mid-ramp, releases at full ramp", () => {
    const over = {
      // Tiny baseline, large derived: without the clamp the sector would
      // book ~40x its counterfactual on the same turn.
      preFlipNameplateRevenue: 24_000,
      plantsCapacity: 10_000,
      plantsMixPrice: 100,
    } as const;
    const baseline = 24_000 / TURNS_PER_DAY;
    const midRamp = resolvePlantsRevenue(
      input({ ...over, plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS / 2 })
    );
    expect(midRamp.baselineHourlyRevenue).toBeCloseTo(baseline, 8);
    expect(midRamp.plantsDerivedHourlyRevenue).toBeGreaterThan(baseline * (1 + GOVERNOR_CAP));
    expect(midRamp.marketHourlyRevenue).toBeLessThanOrEqual(
      baseline * (1 + GOVERNOR_CAP) * 1.000001
    );
    expect(midRamp.marketHourlyRevenue).toBeGreaterThan(baseline);

    const fullRamp = resolvePlantsRevenue(input(over));
    expect(fullRamp.marketHourlyRevenue).toBe(fullRamp.plantsDerivedHourlyRevenue);
  });

  it("emits a capacity-binding event on the newly-bound edge only", () => {
    const bound = resolvePlantsRevenue(
      input({
        sector: {
          ...input().sector,
          sectorType: "extraction",
          capacityUtilization: undefined,
        } as PlantsRevenueInput["sector"],
        capacityUtil: {
          utilization: CAPACITY_BINDING_THRESHOLD - 0.01,
          bindingResource: "oil",
        },
      })
    );
    expect(bound.capacityBindingEvent).not.toBeNull();
    expect(bound.capacityBindingEvent?.utilization).toBeCloseTo(
      CAPACITY_BINDING_THRESHOLD - 0.01,
      10
    );

    // Already bound last turn: no repeat event.
    const stillBound = resolvePlantsRevenue(
      input({
        sector: {
          ...input().sector,
          sectorType: "extraction",
          capacityUtilization: CAPACITY_BINDING_THRESHOLD - 0.05,
        } as PlantsRevenueInput["sector"],
        capacityUtil: {
          utilization: CAPACITY_BINDING_THRESHOLD - 0.01,
          bindingResource: "oil",
        },
      })
    );
    expect(stillBound.capacityBindingEvent).toBeNull();

    // Non-extraction sectors never emit, even when utilization is low.
    const nonExtraction = resolvePlantsRevenue(
      input({
        capacityUtil: {
          utilization: CAPACITY_BINDING_THRESHOLD - 0.01,
          bindingResource: "oil",
        },
      })
    );
    expect(nonExtraction.capacityBindingEvent).toBeNull();
  });

  // Flip identity under a mid-strategy transition: on the flip turn the
  // governor returns the anchor verbatim, so the anchor must be the
  // capital-mode counterfactual even while transitioning. Anchoring on the
  // transitioning nameplate booked headroom plus the blend as revenue
  // (measured +12% on a manufacturing standard to premium flip).
  it("anchors the flip-turn baseline on the pre-flip nameplate while transitioning", () => {
    const r = resolvePlantsRevenue(
      input({
        strategyIsTransitioning: true,
        retoolCapacityRatio: 1.0211,
        plantsNameplateRevenue: PRE_FLIP_REVENUE * 1.1227,
        plantsRampLambda: 0,
        plantsStartTurn: CURRENT_TURN,
      })
    );
    expect(r.baselineHourlyRevenue).toBe(BASELINE_HOURLY);
    expect(r.marketHourlyRevenue).toBe(BASELINE_HOURLY);
  });

  // Past the flip the transitioning nameplate is the anchor again, so the
  // governor fades realized revenue toward the re-aimed plant, not the old mix.
  it("anchors post-flip transitioning turns on the transitioning nameplate", () => {
    const nameplate = PRE_FLIP_REVENUE * 1.1227;
    const r = resolvePlantsRevenue(
      input({
        strategyIsTransitioning: true,
        retoolCapacityRatio: 1.0211,
        plantsNameplateRevenue: nameplate,
        plantsRampLambda: 0.5,
        plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS / 2,
      })
    );
    expect(r.baselineHourlyRevenue).toBeCloseTo(nameplate / TURNS_PER_DAY, 8);
  });

  it("applies the arsenal diversion after the governor, not inside it", () => {
    const diverted = resolvePlantsRevenue(
      input({
        sector: {
          ...input().sector,
          militaryDivertedFraction: 0.5,
          militaryDivertedTurn: CURRENT_TURN,
        } as PlantsRevenueInput["sector"],
      })
    );
    const clean = resolvePlantsRevenue(input());
    expect(diverted.militaryDivertedFraction).toBe(0.5);
    expect(diverted.hourlyRevenue).toBeCloseTo(clean.hourlyRevenue / 2, 10);
    expect(diverted.marketHourlyRevenue).toBeCloseTo(clean.marketHourlyRevenue, 10);
  });
});

describe("absolute cost-plus quotes", () => {
  it("uses fresh blended sales rather than stale per-leg fills when clearing has no leg detail", () => {
    const original = input();
    const result = resolvePlantsRevenue(
      input({
        sector: {
          ...original.sector,
          producedUnits: 1000,
          soldUnits: 1000,
          soldByCommodity: { steel: 1, electronics: 1 },
        },
        strategySupply: { steel: 0.5, electronics: 0.5 },
        clearingEnabled: true,
        clearing: { factor: 0.2, soldFraction: 0.2, effectivePosture: 0 },
      })
    );
    expect(result.producedUnits).toBeCloseTo(230);
  });
  it("responds to the fresh clearing of prior output, not an older persisted fill", () => {
    const original = input();
    const result = resolvePlantsRevenue(
      input({
        sector: {
          ...original.sector,
          producedUnits: 1000,
          soldUnits: 1000,
          soldByCommodity: { steel: 1 },
        },
        strategySupply: { steel: 1 },
        clearingEnabled: true,
        clearing: {
          factor: 0.2,
          soldFraction: 0.2,
          soldByCommodity: { steel: 0.2 },
          effectivePosture: 0,
        },
      })
    );
    expect(result.producedUnits).toBeCloseTo(230);
    expect(result.demandThrottleFactor).toBeCloseTo(0.23);
  });

  it("does not shrink an outlet for units a media ownership law refused", () => {
    // Buyers took all 1000 units; the law refused 350 of them. The plant keeps
    // its run instead of reading 65% sell-through as weak demand.
    const original = input();
    const capped = (blocked: boolean) =>
      resolvePlantsRevenue(
        input({
          sector: { ...original.sector, producedUnits: 1000, soldUnits: 1000 },
          strategySupply: { advertising: 1 },
          clearingEnabled: true,
          clearing: {
            factor: 0.65,
            soldFraction: 0.65,
            soldByCommodity: { advertising: 0.65 },
            ...(blocked
              ? {
                  regulationBlockedFraction: 0.35,
                  regulationBlockedByCommodity: { advertising: 0.35 },
                }
              : {}),
            effectivePosture: 0,
          },
        })
      );
    expect(capped(true).demandThrottleFactor).toBe(1);
    expect(capped(true).producedUnits).toBeCloseTo(1000);
    // Without the blocked share the same sales would cut the run.
    expect(capped(false).producedUnits).toBeLessThan(1000);
  });

  it("uses a scoped share when recovering from a shortage and still caps physical output", () => {
    const original = input();
    const result = resolvePlantsRevenue(
      input({
        sector: {
          ...original.sector,
          producedUnits: 100,
          soldUnits: 20,
          soldByCommodity: { steel: 0.2 },
        },
        strategySupply: { steel: 1 },
        clearingEnabled: true,
        clearing: {
          factor: 1,
          soldFraction: 1,
          soldByCommodity: { steel: 1 },
          marketSupplyShareByCommodity: { steel: 0.1 },
          effectivePosture: 0,
        },
        throttleLegBalance: () => ({ supply: 1000, demand: 2000 }),
        throttleLegMixWeight: () => 1,
      })
    );
    expect(result.producedUnits).toBeCloseTo(200);
  });
  it.each(["extraction", "manufacturing"] as const)(
    "relaxes the shortage fill gate only for extraction (%s)",
    (sectorType) => {
      const original = input();
      const result = resolvePlantsRevenue(
        input({
          sector: {
            ...original.sector,
            sectorType,
            producedUnits: 100,
            soldUnits: 20,
            soldByCommodity: { iron: 0.2 },
          },
          strategySupply: { iron: 1 },
          clearingEnabled: true,
          clearing: {
            factor: 1,
            soldFraction: 0.83,
            soldByCommodity: { iron: 0.83 },
            marketSupplyShareByCommodity: { iron: 0.1 },
            effectivePosture: 0,
          },
          throttleLegBalance: () => ({ supply: 1000, demand: 900 }),
          throttleWideBalance: () => ({ supply: 1000, demand: 2000 }),
          throttleLegMixWeight: () => 1,
        })
      );
      expect(result.producedUnits).toBeCloseTo(sectorType === "extraction" ? 183 : 100);
    }
  );

  it.each([undefined, 0, 100])(
    "keeps extraction history and capacity safeguards (prior production %s)",
    (producedUnits) => {
      const original = input();
      const result = resolvePlantsRevenue(
        input({
          sector: { ...original.sector, sectorType: "extraction", producedUnits, soldUnits: 83 },
          strategySupply: { iron: 1 },
          capacityUtil: { utilization: 0.15, bindingResource: "iron" },
          clearingEnabled: true,
          clearing: {
            factor: 1,
            soldFraction: 0.83,
            soldByCommodity: { iron: 0.83 },
            marketSupplyShareByCommodity: { iron: 0.1 },
            effectivePosture: 0,
          },
          throttleLegBalance: () => ({ supply: 1000, demand: 900 }),
          throttleWideBalance: () => ({ supply: 1000, demand: 2000 }),
          throttleLegMixWeight: () => 1,
        })
      );
      expect(result.producedUnits).toBeCloseTo(150);
    }
  );

  it("settles the offered price during the ramp and adds the tech price bonus on top", () => {
    const base = {
      costPlusPricingEnabled: true,
      clearingEnabled: true,
      clearingFactor: 1.4,
      clearingStartTurn: CURRENT_TURN,
      plantsStartTurn: CURRENT_TURN,
    };
    const plain = resolvePlantsRevenue(
      input({ ...base, techEffects: { outputRateMult: {}, priceRealizationBonus: 0 } })
    );
    const boosted = resolvePlantsRevenue(
      input({ ...base, techEffects: { outputRateMult: {}, priceRealizationBonus: 0.05 } })
    );
    // The posted price is not blended or clamped by the governor.
    expect(boosted.clearingRevenueLeg).toBe(1.4);
    expect(plain.plantsTechPriceLeg).toBe(1);
    expect(plain.marketHourlyRevenue).toBeCloseTo(
      ((plain.producedUnits * 10) / TURNS_PER_DAY) * 1.4,
      8
    );
    // Price realization now moves a cost-plus sector's revenue by exactly its bonus.
    expect(boosted.plantsTechPriceLeg).toBeCloseTo(1.05, 10);
    expect(boosted.marketHourlyRevenue).toBeCloseTo(plain.marketHourlyRevenue * 1.05, 8);
  });
});

describe("governor anchor carries output-per-capacity gains (ticket 1498)", () => {
  it("does not clamp away the 1991 energy productivity ramp mid-governor", () => {
    const over = {
      sector: {
        _id: new ObjectId(),
        sectorType: "energy",
        countryId: "JP",
        stateId: "JP-CHU",
        soldUnits: undefined,
        producedUnits: undefined,
        capacityUtilization: undefined,
        militaryDivertedFraction: 0,
        militaryDivertedTurn: undefined,
      } as PlantsRevenueInput["sector"],
      preset: "1991-default",
      currentTurn: 130,
      plantsStartTurn: 10,
      governorRampTurns: GOVERNOR_RAMP_TURNS,
      plantsCapacity: 1000,
      plantsMixPrice: 10,
      // Nameplate matches capacity x mix price, so only the ramp separates
      // derived revenue from the anchor.
      preFlipNameplateRevenue: 1000 * 10,
      plantsNameplateRevenue: 1000 * 10,
    } as const;
    const r = resolvePlantsRevenue(input(over));
    expect(r.plantsTechOutputMultiplier).toBeGreaterThan(1);
    expect(r.baselineHourlyRevenue).toBeCloseTo(
      ((1000 * 10) / TURNS_PER_DAY) * r.plantsTechOutputMultiplier,
      6
    );
    // Per-unit revenue holds at the mix price instead of being diluted.
    expect(r.marketHourlyRevenue).toBeCloseTo(r.plantsDerivedHourlyRevenue, 6);
  });
});

describe("player-built sectors skip the launch governor (ticket 1498)", () => {
  // Two turns into its own ramp, in a market paying three times the nameplate:
  // the governor holds an ordinary sector near its anchor, but a sector built
  // under plants has nothing to smooth and earns the derived revenue.
  // Anchor: 24,000 a day (1,000 an hour). Derived: 1,000 units x 100 / 24 an
  // hour, about four times the anchor, as in a shortage.
  const NEW_SECTOR_ANCHOR = 24_000;
  const midRamp = {
    plantsStartTurn: CURRENT_TURN - 2,
    plantsMixPrice: 100,
    preFlipNameplateRevenue: NEW_SECTOR_ANCHOR,
    plantsNameplateRevenue: NEW_SECTOR_ANCHOR,
  } as const;

  it("holds a non-exempt new sector near the anchor mid-ramp", () => {
    const r = resolvePlantsRevenue(input(midRamp));
    expect(r.marketHourlyRevenue).toBeLessThan(r.plantsDerivedHourlyRevenue * 0.5);
  });

  it("pays an exempt sector its derived revenue from its first turn", () => {
    const base = input(midRamp);
    const r = resolvePlantsRevenue({
      ...base,
      sector: { ...base.sector, plantsGovernorExempt: true },
    });
    expect(r.marketHourlyRevenue).toBeCloseTo(r.plantsDerivedHourlyRevenue, 6);
    expect(r.marketHourlyRevenue).toBeGreaterThan((NEW_SECTOR_ANCHOR / TURNS_PER_DAY) * 2);
  });

  it("never pays an exempt sector less than the governor would (ticket 1502)", () => {
    // Market pays a tenth of the anchor: the governor holds revenue near the
    // anchor, and the exemption must not drop it to the raw derived value.
    const weak = { ...midRamp, plantsMixPrice: 2.4 } as const;
    const governed = resolvePlantsRevenue(input(weak));
    const base = input(weak);
    const exempt = resolvePlantsRevenue({
      ...base,
      sector: { ...base.sector, plantsGovernorExempt: true },
    });
    expect(governed.marketHourlyRevenue).toBeGreaterThan(governed.plantsDerivedHourlyRevenue);
    expect(exempt.marketHourlyRevenue).toBeCloseTo(governed.marketHourlyRevenue, 6);
  });

  it("still earns nothing when mothballed", () => {
    const base = input({ ...midRamp, mothballed: true });
    const r = resolvePlantsRevenue({
      ...base,
      sector: { ...base.sector, plantsGovernorExempt: true },
    });
    expect(r.marketHourlyRevenue).toBe(0);
  });
});
