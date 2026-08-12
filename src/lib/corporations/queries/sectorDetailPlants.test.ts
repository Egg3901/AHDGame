import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildSectorPlantsSection } from "./sectorDetailSections";
import type { CorporateSector } from "@/lib/db/types";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

function sectorFixture(patch: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    countryId: "US",
    stateId: "CA",
    sectorType: "manufacturing",
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    revenue: 1_000_000,
    profitMargin: 20,
    workers: 100,
    capitalStock: 200,
    producedUnits: 150,
    soldUnits: 120,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  } as CorporateSector;
}

const BASE_ARGS = {
  sectorType: "manufacturing" as const,
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
  corpCapitalAnchor: 10_000_000,
  headroomUnits: 500,
  workers: 100,
  money: {
    realizedRevenueAnchor: 1_000,
    maintenanceNetAnchor: 600,
    labourAnchor: 200,
    growthCostAnchor: 50,
    profitAnchor: 150,
    inputsAnchor: 300,
  },
  regulatoryBurdenPp: 0,
  crisisMarginPenaltyPp: 0,
  depositBound: false,
  fxSpreadRate: 0,
};

describe("buildSectorPlantsSection", () => {
  it("splits capacity into produced, sold, unsold and idle without losing units", () => {
    const s = buildSectorPlantsSection({ eraUnitScale: 1, ...BASE_ARGS, sector: sectorFixture() });
    expect(s.capacityUnits).toBe(200);
    expect(s.producedUnits).toBe(150);
    expect(s.soldUnits).toBe(120);
    expect(s.unsoldUnits).toBe(30);
    expect(s.idleUnits).toBe(50);
    expect(s.fillRate).toBeCloseTo(0.8, 6);
  });

  it("attributes idle capacity exactly — named causes plus other sum to idleUnits", () => {
    const s = buildSectorPlantsSection({
      eraUnitScale: 1,
      ...BASE_ARGS,
      sector: sectorFixture({ throughputFactor: 0.9, strikeStartedAtTurn: 99 }),
      crisisMarginPenaltyPp: -8,
    });
    const total = s.idleCauses.reduce((sum, c) => sum + c.units, 0);
    expect(total).toBeCloseTo(s.idleUnits as number, 6);
    expect(s.idleCauses.map((c) => c.cause)).toContain("inputs");
    expect(s.idleCauses.map((c) => c.cause)).toContain("strike");
  });

  it("reports a mothballed sector's whole capacity as idle under one cause", () => {
    const s = buildSectorPlantsSection({
      eraUnitScale: 1,
      ...BASE_ARGS,
      sector: sectorFixture({ mothballed: true, producedUnits: 0, soldUnits: 0 }),
    });
    expect(s.mothballed).toBe(true);
    expect(s.idleCauses).toEqual([{ cause: "mothballed", units: 200 }]);
  });

  it("keeps the P&L identity: revenue minus every cost line equals the booked profit", () => {
    const s = buildSectorPlantsSection({ eraUnitScale: 1, ...BASE_ARGS, sector: sectorFixture() });
    const costs =
      s.pnl.inputsAnchor +
      s.pnl.labourAnchor +
      s.pnl.upkeepAnchor +
      s.pnl.complianceAnchor +
      s.pnl.otherOperatingAnchor +
      s.pnl.growthAndBuildAnchor;
    expect(s.pnl.revenueAnchor - costs).toBeCloseTo(s.pnl.profitAnchor, 6);
  });

  it("holds the P&L identity when regulation and crises are both live", () => {
    const s = buildSectorPlantsSection({
      eraUnitScale: 1,
      ...BASE_ARGS,
      sector: sectorFixture({ throughputFactor: 0.7 }),
      regulatoryBurdenPp: 5,
      crisisMarginPenaltyPp: -12,
    });
    const costs =
      s.pnl.inputsAnchor +
      s.pnl.labourAnchor +
      s.pnl.upkeepAnchor +
      s.pnl.complianceAnchor +
      s.pnl.otherOperatingAnchor +
      s.pnl.growthAndBuildAnchor;
    expect(s.pnl.revenueAnchor - costs).toBeCloseTo(s.pnl.profitAnchor, 6);
    expect(s.pnl.otherOperatingAnchor).toBeGreaterThanOrEqual(0);
  });

  it("quotes a per-unit build price the dialog can multiply, with an affordable cap", () => {
    const s = buildSectorPlantsSection({ eraUnitScale: 1, ...BASE_ARGS, sector: sectorFixture() });
    expect(s.buildQuote.perUnitAnchor).toBeGreaterThan(0);
    expect(s.buildQuote.maxAffordableUnits).toBe(
      Math.floor(BASE_ARGS.corpCapitalAnchor / s.buildQuote.perUnitAnchor)
    );
    expect(s.buildTurns).toBe(72); // manufacturing
  });

  it("turns the build queue into countdowns the panel can render", () => {
    const s = buildSectorPlantsSection({
      eraUnitScale: 1,
      ...BASE_ARGS,
      sector: sectorFixture({
        buildQueue: [
          { unitsOrdered: 40, costPaidAnchor: 4000, startTurn: 90, onlineTurn: 162 },
          { unitsOrdered: 10, costPaidAnchor: 1000, startTurn: 40, onlineTurn: 100 },
        ],
      }),
    });
    expect(s.buildQueue[0]).toMatchObject({ orderIndex: 0, turnsRemaining: 62 });
    expect(s.buildQueue[1]).toMatchObject({ orderIndex: 1, turnsRemaining: 0, progress: 1 });
  });

  it("counts the governor down from the sector's first plants turn", () => {
    const active = buildSectorPlantsSection({
      eraUnitScale: 1,
      ...BASE_ARGS,
      sector: sectorFixture({ plantsStartTurn: 80 }),
    });
    expect(active.governor).toMatchObject({ active: true, turnsRemaining: 28 });
    const done = buildSectorPlantsSection({
      eraUnitScale: 1,
      ...BASE_ARGS,
      sector: sectorFixture({ plantsStartTurn: 10 }),
    });
    expect(done.governor).toMatchObject({ active: false, turnsRemaining: 0 });
  });

  it("returns null unit fields before the sector's first plants turn has run", () => {
    const s = buildSectorPlantsSection({
      eraUnitScale: 1,
      ...BASE_ARGS,
      sector: sectorFixture({ producedUnits: undefined, soldUnits: undefined }),
    });
    expect(s.producedUnits).toBeNull();
    expect(s.fillRate).toBeNull();
    expect(s.idleCauses).toEqual([]);
  });

  // ─── Truth headline ────────────────────────────────────────────────────────
  describe("truth headline", () => {
    it("computes sold fraction, per-unit received vs cost, and the fill-adjusted margin", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture({
          soldFraction: 0.147,
          soldByCommodity: { steel: 0.2, coal: 0.1 },
        }),
      });
      // The engine's weighted soldFraction wins over the units ratio.
      expect(s.truth.soldFraction).toBeCloseTo(0.147, 6);
      expect(s.truth.soldByCommodity).toEqual([
        { commodity: "steel", fraction: 0.2 },
        { commodity: "coal", fraction: 0.1 },
      ]);
      // Received per PRODUCED unit: 1000 / 150. Cost per produced unit spreads
      // the full operating bill (maintenanceNet 600 + labour 200) over 150.
      expect(s.truth.receivedPerUnitAnchor).toBeCloseTo(1000 / 150, 6);
      expect(s.truth.costPerUnitAnchor).toBeCloseTo(800 / 150, 6);
      // Fill-adjusted margin: profit 150 over the total bill 850 (opex + growth).
      expect(s.truth.fillAdjustedMarginPct).toBeCloseTo((150 / 850) * 100, 6);
    });

    it("falls back to the units ratio when the engine wrote no soldFraction", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture(),
      });
      expect(s.truth.soldFraction).toBeCloseTo(120 / 150, 6);
      expect(s.truth.soldByCommodity).toEqual([]);
    });

    it("returns null per-unit figures at zero produced without dividing by zero", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture({ producedUnits: 0, soldUnits: 0 }),
        money: { ...BASE_ARGS.money, realizedRevenueAnchor: 0, profitAnchor: -850 },
      });
      expect(s.truth.receivedPerUnitAnchor).toBeNull();
      expect(s.truth.costPerUnitAnchor).toBeNull();
      // Costs still exist, so the fill-adjusted margin is a real (deeply
      // negative) number, and there is no path to profit at this fill.
      expect(s.truth.fillAdjustedMarginPct).toBeCloseTo(-100, 6);
      expect(s.truth.breakEven).toEqual({ status: "not_at_current_fills", turns: null });
    });

    it("handles zero sold with positive production: everything made, nothing bought", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture({ soldUnits: 0 }),
        money: { ...BASE_ARGS.money, realizedRevenueAnchor: 0, profitAnchor: -850 },
      });
      expect(s.truth.soldFraction).toBe(0);
      expect(s.truth.receivedPerUnitAnchor).toBe(0);
      expect(s.truth.costPerUnitAnchor).toBeCloseTo(800 / 150, 6);
      expect(s.truth.breakEven.status).toBe("not_at_current_fills");
    });

    it("treats sold == produced as a full fill with received above cost", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture({ soldUnits: 150 }),
      });
      expect(s.truth.soldFraction).toBe(1);
      expect(s.truth.receivedPerUnitAnchor! > s.truth.costPerUnitAnchor!).toBe(true);
    });

    it("reports profitable now at zero CIP with positive profit", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture(),
      });
      expect(s.truth.breakEven).toEqual({ status: "profitable_now", turns: null });
    });

    it("counts break-even turns against outstanding CIP on the per-turn clock", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture({ constructionInProgressAnchor: 100 }),
      });
      // Profit is 150 ₳ per financial DAY, i.e. 150 / 24 per turn.
      expect(s.truth.breakEven).toEqual({ status: "turns", turns: Math.ceil(100 / (150 / 24)) });
    });

    it("says not at current fills when CIP is outstanding and profit is not positive", () => {
      const s = buildSectorPlantsSection({
        eraUnitScale: 1,
        ...BASE_ARGS,
        sector: sectorFixture({ constructionInProgressAnchor: 100 }),
        money: { ...BASE_ARGS.money, profitAnchor: -10 },
      });
      expect(s.truth.breakEven).toEqual({ status: "not_at_current_fills", turns: null });
    });
  });
});
