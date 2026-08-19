/**
 * Ticket 1122 follow-up: the sector page reads the engine's booked profit
 * instead of reconstructing it from a capped percentage.
 *
 * The two fixtures are the owner's live prod sectors, at their real values:
 *  - a California newsroom at an 88.63 engine margin, which reconciles and must
 *    keep reconciling,
 *  - a Washington DC newsroom whose derived margin saturated at exactly 100, so
 *    the old inversion reported an operating cost of zero and a profit equal to
 *    revenue.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildSectorPlantsSection } from "./sectorDetailSections";
import { buildPolicyStackRows, readPlantsPnl } from "@/lib/corporations/plantsPnlBasis";
import type { CorporateSector } from "@/lib/db/types";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

function sectorFixture(patch: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    countryId: "US",
    stateId: "CA",
    sectorType: "media",
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    revenue: 243_873.89,
    profitMargin: 35,
    workers: 100,
    capitalStock: 72_673.78,
    producedUnits: 72_673.78,
    soldUnits: 72_673.78,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  } as CorporateSector;
}

const BASE_ARGS = {
  sectorType: "media" as const,
  currentTurn: 100,
  currentYear: 1953,
  governorCap: 0.15,
  governorRampTurns: 48,
  marketSharePercent: 10,
  competitorCount: 3,
  primeRate: 4,
  ceoAcumen: NEUTRAL_STAT,
  hostCostOfLivingIndex: 100,
  techGrowthCostMultiplier: 1,
  eraUnitScale: 1,
  corpCapitalAnchor: 10_000_000,
  headroomUnits: 500,
  workers: 100,
  regulatoryBurdenPp: 0,
  crisisMarginPenaltyPp: 0,
  depositBound: false,
  fxSpreadRate: 0,
};

/** A plants P&L whose lines are internally consistent, like the engine's. */
function enginePnl(p: {
  revenue: number;
  inputs: number;
  labour: number;
  upkeep: number;
  compliance: number;
  otherOpex: number;
  financialLegs?: number;
  inventoryCarry?: number;
  policyCredit: number;
  policyPp?: number;
  growth?: number;
}) {
  const financialLegs = p.financialLegs ?? 0;
  const inventoryCarry = p.inventoryCarry ?? 0;
  const growth = p.growth ?? 0;
  const operatingCost = p.inputs + p.labour + p.otherOpex + financialLegs - p.policyCredit;
  const totalCost = operatingCost + p.upkeep + p.compliance + growth + inventoryCarry;
  return {
    revenue: p.revenue,
    inputs: p.inputs,
    labour: p.labour,
    upkeep: p.upkeep,
    compliance: p.compliance,
    otherOpex: p.otherOpex,
    financialLegs,
    inventoryCarry,
    policyCredit: p.policyCredit,
    policyPp: p.policyPp ?? 0,
    operatingCost,
    totalCost,
    profit: p.revenue - totalCost,
  };
}

/** The panel's on-screen identity: revenue minus every cost line is profit. */
function panelIdentity(pnl: {
  revenueAnchor: number;
  inputsAnchor: number;
  labourAnchor: number;
  upkeepAnchor: number;
  complianceAnchor: number;
  policyAnchor: number;
  otherOperatingAnchor: number;
  growthAndBuildAnchor: number;
}) {
  return (
    pnl.revenueAnchor -
    (pnl.inputsAnchor +
      pnl.labourAnchor +
      pnl.upkeepAnchor +
      pnl.complianceAnchor +
      -pnl.policyAnchor +
      pnl.otherOperatingAnchor +
      pnl.growthAndBuildAnchor)
  );
}

describe("sector page profit under plants (ticket 1122)", () => {
  it("shows the engine's profit, not revenue, when the derived margin saturates at 100", () => {
    // Washington DC newsroom, prod 6a779f41e464c15609c01cbf. The policy credit
    // outruns the operating bill, so operating cost is negative and the booked
    // profit is ABOVE revenue. Inverting a margin capped at 100 gives an
    // operating cost of 0 and profit == revenue.
    const engine = enginePnl({
      revenue: 1_274_732.13,
      inputs: 120_000,
      labour: 204_170.26,
      upkeep: 0,
      compliance: 0,
      otherOpex: -10_800,
      policyCredit: 420_000,
      policyPp: 32.95,
    });
    expect(engine.operatingCost).toBeLessThan(0);
    expect(engine.profit).toBeGreaterThan(engine.revenue);

    const s = buildSectorPlantsSection({
      ...BASE_ARGS,
      sector: sectorFixture({ stateId: "DC", effectiveProfitMargin: 100 }),
      money: {
        realizedRevenueAnchor: engine.revenue,
        // What computeSectorMarginSection now returns: the engine's own lines.
        maintenanceNetAnchor: engine.operatingCost - engine.labour,
        labourAnchor: engine.labour,
        growthCostAnchor: 0,
        profitAnchor: engine.profit,
        inputsAnchor: engine.inputs,
        enginePnl: engine,
      },
    });

    expect(s.pnl.profitAnchor).toBeCloseTo(engine.profit, 6);
    // The defect: profit displayed as exactly revenue.
    expect(s.pnl.profitAnchor).not.toBeCloseTo(engine.revenue, 2);
    expect(s.pnl.profitAnchor).toBeGreaterThan(s.pnl.revenueAnchor);
    expect(panelIdentity(s.pnl)).toBeCloseTo(engine.profit, 6);
  });

  it("keeps the 88.63 sector reconciling, line for line", () => {
    // California newsroom, prod 6a83e59f97baa9dbe6bb7980. Uncapped, so the old
    // inversion and the engine agree on operating cost; the engine additionally
    // carries upkeep and compliance, which the margin's scope leaves out.
    const engine = enginePnl({
      revenue: 321_760.57,
      inputs: 24_000,
      labour: 70_561.75,
      upkeep: 1_500,
      compliance: 0,
      otherOpex: -5_477.65,
      policyCredit: 52_500,
      policyPp: 16.32,
    });
    // 100 x (1 - operatingCost/revenue) is the 88.63 the row carries, uncapped.
    const derived = 100 * (1 - engine.operatingCost / engine.revenue);
    expect(derived).toBeGreaterThan(0);
    expect(derived).toBeLessThan(100);

    const s = buildSectorPlantsSection({
      ...BASE_ARGS,
      sector: sectorFixture({ effectiveProfitMargin: Math.round(derived * 100) / 100 }),
      money: {
        realizedRevenueAnchor: engine.revenue,
        maintenanceNetAnchor: engine.operatingCost - engine.labour,
        labourAnchor: engine.labour,
        growthCostAnchor: 0,
        profitAnchor: engine.profit,
        inputsAnchor: engine.inputs,
        enginePnl: engine,
      },
    });

    expect(s.pnl.revenueAnchor).toBeCloseTo(engine.revenue, 6);
    expect(s.pnl.inputsAnchor).toBeCloseTo(engine.inputs, 6);
    expect(s.pnl.labourAnchor).toBeCloseTo(engine.labour, 6);
    expect(s.pnl.upkeepAnchor).toBeCloseTo(engine.upkeep, 6);
    expect(s.pnl.policyAnchor).toBeCloseTo(engine.policyCredit, 6);
    expect(s.pnl.profitAnchor).toBeCloseTo(engine.profit, 6);
    expect(panelIdentity(s.pnl)).toBeCloseTo(engine.profit, 6);
  });

  it("falls back to the old reconstruction when the row has no engine P&L", () => {
    const s = buildSectorPlantsSection({
      ...BASE_ARGS,
      sector: sectorFixture(),
      money: {
        realizedRevenueAnchor: 1_000,
        maintenanceNetAnchor: 600,
        labourAnchor: 200,
        growthCostAnchor: 50,
        profitAnchor: 150,
        inputsAnchor: 300,
      },
    });
    expect(s.pnl.policyAnchor).toBe(0);
    expect(s.policyStack).toEqual([]);
    // Same identity as before this change: the residual absorbs the difference.
    expect(panelIdentity(s.pnl)).toBeCloseTo(150, 6);
  });
});

describe("readPlantsPnl", () => {
  it("rejects a partial row rather than letting a broken chain render", () => {
    expect(readPlantsPnl({} as never)).toBeNull();
    expect(readPlantsPnl({ plantsPnl: { revenue: 100, inputs: 10 } } as never)).toBeNull();
  });
});

describe("buildPolicyStackRows", () => {
  it("sums to the policy line it explains, exactly", () => {
    const rows = buildPolicyStackRows({
      policyCreditAnchor: 420_000,
      revenueAnchor: 1_274_732.13,
      mods: {
        subsidyModifier: 12,
        foreignTariffModifier: -3,
        stateMetricsModifier: 8.5,
        corruptionModifier: -2.5,
        techMarginBonus: 4,
      },
    });
    expect(rows).toHaveLength(5);
    expect(rows.reduce((s, r) => s + r.anchor, 0)).toBeCloseTo(420_000, 6);
    // Sign is preserved: a tariff hurts, a subsidy helps.
    expect(rows.find((r) => r.key === "subsidyModifier")!.anchor).toBeGreaterThan(0);
    expect(rows.find((r) => r.key === "foreignTariffModifier")!.anchor).toBeLessThan(0);
  });

  it("still sums to a NEGATIVE line when the stack is a net charge", () => {
    const rows = buildPolicyStackRows({
      policyCreditAnchor: -18_000,
      revenueAnchor: 200_000,
      mods: { domesticTariffMalus: -6, subsidyModifier: 2 },
    });
    expect(rows.reduce((s, r) => s + r.anchor, 0)).toBeCloseTo(-18_000, 6);
  });

  it("returns nothing to explain when there is no credit", () => {
    expect(
      buildPolicyStackRows({
        policyCreditAnchor: 0,
        revenueAnchor: 200_000,
        mods: { subsidyModifier: 5 },
      })
    ).toEqual([]);
  });
});
