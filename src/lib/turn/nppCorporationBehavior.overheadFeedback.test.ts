/**
 * Regression coverage for the market-economy overhead-runaway defect.
 *
 * Diagnosis (see nppCorporationBehavior.ts's "Profitability analysis" block
 * for the full writeup): section 3's marketing/logistics/R&D budget bands
 * were selected from a profitability signal (`corpMargin`/`isProfitable`)
 * that was pure SECTOR income — before the very marketing/logistics/R&D/
 * CEO-salary overhead that section was about to size — AND that signal, plus
 * the budget $ amounts themselves, were sized off NOMINAL (book) revenue
 * rather than REALIZED (actually-collected) revenue. On a stopped 657-turn
 * world this let overhead drift from ~0% to 28-49% of revenue while the
 * sector-level margin the NPP was reading stayed flat the entire run — the
 * NPP never saw a reason to cut spend, because nothing it read ever moved.
 *
 * These tests drive `makeNppCorpDecision` across many turns with a
 * degrading REALIZED-vs-nominal revenue gap (the actual mechanism observed
 * in the stopped world — capacity/price/clearing/throughput realization
 * eroding while nominal revenue and margin hold steady) and assert the
 * resulting cost-to-revenue ratio stabilises instead of drifting — plus a
 * companion test that a genuinely healthy, fully-realized corp still invests.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { makeNppCorpDecision, type CommodityPriceRatioFn } from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const noPrices: CommodityPriceRatioFn = () => null;
const noUnowned = new Map();
const noState = new Set<string>();
const modifiers = ceoArchetypeModifiers("cautious"); // neutral baseline archetype

const NOMINAL_REVENUE = 10_000_000;
const STRONG_MARGIN = 30; // "strong" band throughout — mirrors the diagnosed run,
// where the sector-level margin signal stabilised early and never moved again.

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "CA",
    liquidCapital: 50_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "CA",
    revenue: NOMINAL_REVENUE,
    effectiveProfitMargin: STRONG_MARGIN,
    profitMargin: STRONG_MARGIN,
    targetGrowthRate: 2,
    currentGrowthCost: 0,
    ...overrides,
  } as unknown as CorporateSector;
}

interface TurnSample {
  turn: number;
  costToRevenueRatio: number;
  marketingBudget: number;
  logisticsBudget: number;
  rdBudget: number;
}

/**
 * Runs `turns` rounds of makeNppCorpDecision, threading each turn's decision
 * back into corp/sector state for the next turn exactly as
 * processNppCorporationDecisions' bulkWrite would, then applies a simplified
 * per-turn cost model mirroring sectorCalculations.ts's conversion of daily
 * marketing/logistics/R&D/CEO-salary budgets into per-turn charges against
 * the sector's REALIZED revenue (growth cost is deliberately held at 0 the
 * whole run — it is a separately-governed, already-fixed mechanism; this
 * harness isolates the overhead-only feedback loop the diagnosis describes).
 */
function simulate(turns: number, realizationRatioAt: (turn: number) => number): TurnSample[] {
  let corp = makeCorp();
  let sector = makeSector();
  const samples: TurnSample[] = [];

  for (let turn = 1; turn <= turns; turn++) {
    const realizationRatio = realizationRatioAt(turn);
    sector = {
      ...sector,
      realizedRevenue: (sector.revenue ?? 0) * realizationRatio,
    };

    const decision = makeNppCorpDecision(
      { corp, sectors: [sector], turn, now: new Date(), modifiers },
      noUnowned,
      noState,
      noPrices
    );

    corp = { ...corp, ...decision.updates } as Corporation;
    for (const su of decision.sectorUpdates) {
      sector = { ...sector, ...su.update.$set } as CorporateSector;
    }

    const hourlyRealizedRevenue = (sector.realizedRevenue ?? 0) / TURNS_PER_DAY;
    const maintenance = hourlyRealizedRevenue * (1 - (sector.effectiveProfitMargin ?? 0) / 100);
    const overheadPerTurn =
      ((corp.marketingBudget ?? 0) +
        (corp.logisticsBudget ?? 0) +
        (corp.rdBudget ?? 0) +
        (corp.ceoSalary ?? 0)) /
      TURNS_PER_DAY;
    const totalCosts = maintenance + overheadPerTurn;
    const income = hourlyRealizedRevenue - totalCosts;

    corp = { ...corp, liquidCapital: (corp.liquidCapital ?? 0) + income } as Corporation;

    samples.push({
      turn,
      costToRevenueRatio: hourlyRealizedRevenue > 0 ? totalCosts / hourlyRealizedRevenue : NaN,
      marketingBudget: corp.marketingBudget ?? 0,
      logisticsBudget: corp.logisticsBudget ?? 0,
      rdBudget: corp.rdBudget ?? 0,
    });
  }

  return samples;
}

describe("makeNppCorpDecision — overhead feedback loop (market-economy runaway fix)", () => {
  it("stabilises the cost-to-revenue ratio even as realized revenue keeps eroding away from nominal", () => {
    // Realized revenue decays every single turn for the whole run (never
    // plateaus) — 0.97^turn — modeling the capacity/price/clearing/
    // throughput realization drift observed in the stopped world while
    // nominal revenue and margin stay fixed. A budget sized as a % of
    // NOMINAL revenue would be a CONSTANT dollar figure here, so charged
    // against ever-shrinking realized revenue its cost-to-revenue ratio
    // would grow without bound. Sized off realized revenue instead, the
    // ratio should track the sector's own maintenance+overhead shape and
    // stay flat regardless of how far realized revenue has fallen.
    const samples = simulate(120, (turn) => Math.max(0.01, Math.pow(0.97, turn)));

    // Sanity: the erosion is real and substantial across the run.
    const earlyRealization = Math.pow(0.97, 10);
    const lateRealization = Math.pow(0.97, 110);
    expect(lateRealization).toBeLessThan(earlyRealization * 0.1);

    // The ratio must not exhibit the runaway the bug produced: compare the
    // late-run average to the early/mid-run average rather than a single
    // turn, since a single-turn check can't distinguish "stable" from
    // "coincidentally equal this turn".
    const early = samples.slice(9, 29).map((s) => s.costToRevenueRatio);
    const mid = samples.slice(49, 69).map((s) => s.costToRevenueRatio);
    const late = samples.slice(99, 119).map((s) => s.costToRevenueRatio);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const earlyAvg = avg(early);
    const midAvg = avg(mid);
    const lateAvg = avg(late);

    // Old behavior would drive this ratio from ~0.7-0.8 up past 1.0 and
    // climbing without bound as realized revenue keeps shrinking toward its
    // floor. Fixed behavior keeps it essentially flat.
    expect(Math.abs(lateAvg - earlyAvg)).toBeLessThan(0.05);
    expect(Math.abs(lateAvg - midAvg)).toBeLessThan(0.05);
    expect(lateAvg).toBeLessThan(1); // still net profitable, not runaway past break-even
  });

  it("still invests when the corp is genuinely healthy and fully realized — no paralysis", () => {
    // No realization gap at all — revenue is fully collected every turn.
    // A corp with a real 30% gross margin and no overhead drag should NOT be
    // paralyzed into minimum spend; that would be over-correcting into the
    // opposite failure mode the task explicitly warns against.
    const samples = simulate(10, () => 1);
    const first = samples[0];
    const last = samples[samples.length - 1];

    // Turn 1 has no prior-turn overhead to net out yet, so the corp reads its
    // full 30% gross margin and picks the "strong" band (5%/3%/2% of revenue).
    const strongMarketing = NOMINAL_REVENUE * 0.05 * modifiers.marketingMult;
    const strongLogistics = NOMINAL_REVENUE * 0.03;
    const strongRd = NOMINAL_REVENUE * 0.02 * modifiers.rdMult;
    expect(first.marketingBudget).toBeCloseTo(strongMarketing, -2);
    expect(first.logisticsBudget).toBeCloseTo(strongLogistics, -2);
    expect(first.rdBudget).toBeCloseTo(strongRd, -2);

    // From turn 2 on, last turn's overhead is netted out of the 30% gross
    // margin (≈24.8% net), which settles into the "healthy" band (3%/2%/1%)
    // — a real, sustained fixed point, not a collapse toward zero. This is
    // the fix working as intended: a corp that is ACTUALLY affordable after
    // its own overhead keeps investing, just no longer off an inflated,
    // overhead-blind margin reading.
    const healthyMarketing = NOMINAL_REVENUE * 0.03 * modifiers.marketingMult;
    const healthyLogistics = NOMINAL_REVENUE * 0.02;
    const healthyRd = NOMINAL_REVENUE * 0.01 * modifiers.rdMult;
    expect(last.marketingBudget).toBeCloseTo(healthyMarketing, -2);
    expect(last.logisticsBudget).toBeCloseTo(healthyLogistics, -2);
    expect(last.rdBudget).toBeCloseTo(healthyRd, -2);

    // Confirms it is real, sustained investment — not the "losing money"
    // floor (0.5%/0.3%/0%) the fix falls back to when unaffordable.
    const floorMarketing = NOMINAL_REVENUE * 0.005 * modifiers.marketingMult;
    expect(last.marketingBudget).toBeGreaterThan(floorMarketing * 5);
    expect(last.rdBudget).toBeGreaterThan(0);

    // And the cost-to-revenue ratio should sit comfortably under 1 — a
    // profitable, well-run firm, not a firm cutting itself into paralysis —
    // and hold steady turn over turn rather than oscillating.
    expect(last.costToRevenueRatio).toBeLessThan(0.85);
    expect(Math.abs(last.costToRevenueRatio - samples[5].costToRevenueRatio)).toBeLessThan(0.001);
  });
});
