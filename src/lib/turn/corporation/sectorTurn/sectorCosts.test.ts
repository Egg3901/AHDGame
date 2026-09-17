import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  computeGrowthAndRegulatory,
  decomposePhysicalCosts,
  type GrowthRegulatoryInput,
  type PhysicalCostsInput,
} from "./sectorCosts";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

const NEW_GROWTH_COST = 24_000;
const PRE_FLIP_REVENUE = 240_000;
const NOMINAL_HOURLY = PRE_FLIP_REVENUE / TURNS_PER_DAY;
/** Well above the dominance threshold, so the regulatory rate is live. */
const DOMINANT_SHARE = 70;

function growthInput(over: Partial<GrowthRegulatoryInput> = {}): GrowthRegulatoryInput {
  return {
    corp: {
      _id: new ObjectId(),
      countryOwnerId: undefined,
      ownershipState: "private",
    } as GrowthRegulatoryInput["corp"],
    newGrowthCost: NEW_GROWTH_COST,
    preFlipNameplateRevenue: PRE_FLIP_REVENUE,
    hourlyRevenue: NOMINAL_HOURLY,
    sectorMarketSharePct: 0,
    nationalDominanceSharePct: 0,
    dominanceShield: 0,
    plantsEnabled: false,
    plantsRampLambda: 1,
    ...over,
  };
}

function physicalInput(over: Partial<PhysicalCostsInput> = {}): PhysicalCostsInput {
  return {
    plantsEnabled: true,
    embargoLegacyMothball: false,
    profitMargin: 20,
    totalMarginMod: 0,
    commodityMod: 0,
    surplusMod: 0,
    disasterMarginMod: 0,
    nationalizedMarginPenalty: 0,
    hourlyRevenue: 10_000,
    maintenance: 5_000,
    sectorLaborCost: 2_000,
    plantsUpkeepCost: 100,
    regulatoryBurden: 50,
    hourlyGrowthCost: 200,
    plantsNameplateRevenue: PRE_FLIP_REVENUE,
    effectiveDemand: {},
    sectorCountryId: "US",
    priceRatioByCommodity: new Map(),
    reachableInputPriceRatiosByCountry: new Map(),
    plantsCapacity: 1000,
    producedUnits: 800,
    retoolCapacityRatio: 1,
    newPolicyLevel: 0,
    mothballed: false,
    stateId: "US-CA",
    landedPremiumByState: new Map(),
    storedOtherOpexAnchor: null,
    healedOtherOpexPerUnitAnchor: undefined,
    otherOpexAnchorMarginBasis: null,
    capitalEnabled: false,
    prevCapitalBookAnchor: undefined,
    ...over,
  };
}

describe("computeGrowthAndRegulatory — realized-revenue growth + burden (#588)", () => {
  it("charges the full daily cost when revenue is fully realized", () => {
    const r = computeGrowthAndRegulatory(growthInput());
    expect(r.realizationRatio).toBe(1);
    expect(r.hourlyGrowthCost).toBeCloseTo(NEW_GROWTH_COST / TURNS_PER_DAY, 10);
  });

  it("scales growth cost by the realization ratio, clamped to [0, 1]", () => {
    const half = computeGrowthAndRegulatory(growthInput({ hourlyRevenue: NOMINAL_HOURLY / 2 }));
    expect(half.realizationRatio).toBeCloseTo(0.5, 10);
    expect(half.hourlyGrowthCost).toBeCloseTo(NEW_GROWTH_COST / TURNS_PER_DAY / 2, 10);

    const over = computeGrowthAndRegulatory(growthInput({ hourlyRevenue: NOMINAL_HOURLY * 3 }));
    expect(over.realizationRatio).toBe(1);

    const zero = computeGrowthAndRegulatory(growthInput({ hourlyRevenue: 0 }));
    expect(zero.realizationRatio).toBe(0);
    expect(zero.hourlyGrowthCost).toBe(0);
  });

  it("falls back to a ratio of 1 when there is no nominal book", () => {
    const r = computeGrowthAndRegulatory(
      growthInput({ preFlipNameplateRevenue: 0, hourlyRevenue: 0 })
    );
    expect(r.realizationRatio).toBe(1);
  });

  it("exempts state-owned corps from the regulatory burden in every mode", () => {
    const soe = growthInput({
      corp: {
        _id: new ObjectId(),
        countryOwnerId: "US",
        ownershipState: "stateOwned",
      } as GrowthRegulatoryInput["corp"],
      sectorMarketSharePct: DOMINANT_SHARE,
      hourlyRevenue: NOMINAL_HOURLY,
    });
    const r = computeGrowthAndRegulatory(soe);
    expect(r.regulatoryBurdenRate).toBe(0);
    expect(r.regulatoryBurden).toBe(0);
  });

  it("fades the dominance burden out over the plants ramp", () => {
    const atFlip = computeGrowthAndRegulatory(
      growthInput({
        sectorMarketSharePct: DOMINANT_SHARE,
        plantsEnabled: true,
        plantsRampLambda: 0,
      })
    );
    const atFullRamp = computeGrowthAndRegulatory(
      growthInput({
        sectorMarketSharePct: DOMINANT_SHARE,
        plantsEnabled: true,
        plantsRampLambda: 1,
      })
    );
    const capitalMode = computeGrowthAndRegulatory(
      growthInput({ sectorMarketSharePct: DOMINANT_SHARE })
    );
    expect(atFlip.regulatoryBurdenRate).toBeGreaterThan(0);
    expect(atFlip.regulatoryBurdenRate).toBeCloseTo(capitalMode.regulatoryBurdenRate, 10);
    expect(atFullRamp.regulatoryBurdenRate).toBe(0);
    expect(atFullRamp.regulatoryBurden).toBe(0);
  });
});

describe("decomposePhysicalCosts — P3.5 calibration exactness (#588)", () => {
  it("is inert when plants are off", () => {
    const r = decomposePhysicalCosts(physicalInput({ plantsEnabled: false }));
    expect(r.plantsPhysicalEnabled).toBe(false);
    expect(r.physicalPnl).toBeNull();
    expect(r.solvedOtherOpexPerUnit).toBeNull();
    expect(r.otherOpex).toBe(0);
    expect(r.plantsPolicyCredit).toBe(0);
    expect(r.inputsCost).toBe(0);
    expect(r.financialLegs).toBe(0);
  });

  it("derives the policy stack from the margin stack minus physical legs", () => {
    const r = decomposePhysicalCosts(
      physicalInput({
        totalMarginMod: 10,
        commodityMod: 3,
        surplusMod: 2,
        disasterMarginMod: 1,
        nationalizedMarginPenalty: -4,
      })
    );
    // 10 − 3 − 2 − 1 + (−4) = 0.
    expect(r.plantsPolicyPpRaw).toBeCloseTo(0, 10);
    expect(r.plantsPolicyNeutralBasis).toBeCloseTo(0.8, 10);
  });

  // Calibration identity: on the first producing turn the residual is solved
  // so the physical lines reproduce `maintenance` exactly —
  // otherOpex = maintenance + policyCredit − labour − inputs − financialLegs.
  it("calibrates the residual to reproduce maintenance exactly", () => {
    const r = decomposePhysicalCosts(physicalInput());
    expect(r.otherOpexCalibrated).toBe(true);
    expect(r.solvedOtherOpexPerUnit).not.toBeNull();
    expect(r.otherOpex).toBeCloseTo(
      5_000 + r.plantsPolicyCredit - 2_000 - r.inputsCost - r.financialLegs,
      8
    );
    // The solved per-unit anchor restates the same residual per output unit.
    expect(r.solvedOtherOpexPerUnit!).toBeCloseTo(r.otherOpex / 800, 8);
  });

  it("defers calibration per-unit when nothing was produced, staying exact", () => {
    const r = decomposePhysicalCosts(physicalInput({ producedUnits: 0 }));
    expect(r.otherOpexCalibrated).toBe(true);
    expect(r.otherOpex).toBeCloseTo(
      5_000 + r.plantsPolicyCredit - 2_000 - r.inputsCost - r.financialLegs,
      8
    );
  });

  it("holds a stamped anchor instead of recalibrating", () => {
    const r = decomposePhysicalCosts(physicalInput({ storedOtherOpexAnchor: 2.5 }));
    expect(r.otherOpexCalibrated).toBe(false);
    expect(r.solvedOtherOpexPerUnit).toBeNull();
    expect(r.otherOpex).toBeCloseTo(2.5 * 800, 8);
  });

  it("reports hourly profit from the assembled P&L under plants", () => {
    const r = decomposePhysicalCosts(physicalInput());
    expect(r.physicalPnl).not.toBeNull();
    expect(r.hourlyProfit).toBe(r.physicalPnl!.profit);
    expect(r.sectorNPV).toBeGreaterThanOrEqual(0);
    expect(r.capitalBookAnchor).toBe(0);
  });
});
