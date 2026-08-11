/**
 * Command Economy v2 (P3) — deterministic balance harness.
 *
 * Composes the REAL command-economy kernels (marketizationDrift, directed
 * credit, overhang/shortage/black-market, policy stance) exactly as
 * `processCommandEconomyTurn` does for one country, over N turns — WITHOUT the
 * DB or the full market engine. The one exogenous input the full engine would
 * supply is each SOE's realized output; the harness models it as
 * `soeCompetence * planTarget` capped by (credit-grown) capacity, so a scenario
 * can hold "how well the SOEs run" fixed and observe how the endogenous feedback
 * loop (marketization drift, shortage, overhang, plan fulfillment) responds to
 * the Gosbank/government posture and the drift knobs.
 *
 * This is a KERNEL-level validator (fast, deterministic, no Mongo), used to tune
 * MARKETIZATION_DRIFT_WEIGHTS / CREDIT_* against the P3 target behaviours. It is
 * NOT a substitute for the full-engine runWorld --command-economy run; the two
 * are cross-checked in the P3 balance note.
 *
 * Run: SIM has no side effects. `npx tsx scripts/sim/commandEconomyBalanceHarness.ts`
 */

import {
  MARKETIZATION_DRIFT_WEIGHTS,
  marketizationDrift,
  driftMarketizationLevel,
  computePolicyStance,
  plannedShare,
  setStoredMarketizationLevel,
  marketizationLevel,
  scheduledMarketizationLevel,
  clearStoredMarketizationLevels,
} from "@/lib/constants/commandEconomy";
import {
  accumulateOverhang,
  shortageIndexFrom,
  blackMarketPremiumFrom,
  updateSecondEconomy,
  blackMarketPressure,
  overhangInjectionFromIssuance,
} from "@/lib/economy/commandEconomyState";
import {
  aggregatePlanFulfillment,
  resolveCreditAllocation,
  applyDirectedCreditToSoe,
  directedCreditBudget,
  directedCreditIssuance,
  SOE_PERF_BASELINE,
  makeSeedSoeState,
} from "@/lib/economy/soe";
import { wageFundConstrainedGrowth } from "@/lib/economy/twoCircuitMoney";
import type { SoeState } from "@/lib/db/types/corporation";
import type { CorporationType } from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

type Scenario = {
  name: string;
  countryId: string;
  year: number;
  sectors: CorporationType[];
  planTargetPerSoe: number;
  /** exogenous realization: output = competence*planTarget capped by capacity. */
  soeCompetence: number;
  creditAggressiveness: number;
  budgetSoftness: number;
  reformism: number;
  tolerance: number;
  wageGrowth: number; // annual %
  gdpGrowth: number; // annual %
  turns: number;
};

type Sample = {
  turn: number;
  year: number;
  level: number;
  soePerf: number;
  shortage: number;
  overhang: number;
  premium: number;
  secondShare: number;
  drift: number;
};

function runScenario(s: Scenario): { samples: Sample[]; final: Sample } {
  clearStoredMarketizationLevels();
  const enabled = true;
  let level = scheduledMarketizationLevel(s.countryId, s.year);
  setStoredMarketizationLevel(s.countryId, level);

  // Seed one SOE per sector, on-plan.
  let soes: SoeState[] = s.sectors.map((sec) => makeSeedSoeState(sec, s.planTargetPerSoe));

  let overhang = 0;
  let secondShare = 0;
  let shortageIndex = 0;
  const samples: Sample[] = [];

  for (let t = 1; t <= s.turns; t++) {
    setStoredMarketizationLevel(s.countryId, level);
    const share = plannedShare(s.countryId, s.year, enabled);

    // Market realization refresh (what loadSoeStates does from sector output),
    // modeled as competence*planTarget capped by current capacity.
    soes = soes.map((soe) => {
      const realized = Math.min(soe.capacity, Math.round(soe.planTarget * s.soeCompetence));
      return { ...soe, output: realized };
    });

    const aggPlanTarget = soes.reduce((sum, x) => sum + x.planTarget, 0);
    const creditTotal = directedCreditBudget(aggPlanTarget, s.creditAggressiveness);
    const allocation = resolveCreditAllocation(
      soes.map((x) => ({ sector: x.sector, output: x.output, planTarget: x.planTarget })),
      creditTotal,
      null
    );
    soes = soes.map((soe) => applyDirectedCreditToSoe(soe, allocation.get(soe.sector) ?? 0));

    const soePerf = soes.length > 0 ? aggregatePlanFulfillment(soes) : SOE_PERF_BASELINE;

    const monetizedIssuance = directedCreditIssuance(creditTotal);
    const creditInjection = overhangInjectionFromIssuance(monetizedIssuance, aggPlanTarget, share);

    const constrainedWageGrowth = wageFundConstrainedGrowth(s.wageGrowth, s.gdpGrowth, share);
    const relief = updateSecondEconomy(secondShare, shortageIndex, overhang, s.tolerance).relief;
    overhang = accumulateOverhang(
      overhang,
      constrainedWageGrowth,
      s.gdpGrowth,
      share,
      relief,
      creditInjection
    );
    shortageIndex = shortageIndexFrom(overhang);
    const premium = blackMarketPremiumFrom(shortageIndex, overhang, s.tolerance);
    secondShare = updateSecondEconomy(secondShare, shortageIndex, overhang, s.tolerance).share;

    const pressure = blackMarketPressure(shortageIndex, premium, secondShare);
    const policyStance = computePolicyStance(s.reformism, s.creditAggressiveness, s.budgetSoftness);
    const drift = marketizationDrift(pressure, soePerf, policyStance);
    level = driftMarketizationLevel(level, drift);

    samples.push({
      turn: t,
      year: s.year + t / TURNS_PER_YEAR,
      level,
      soePerf,
      shortage: shortageIndex,
      overhang,
      premium,
      secondShare,
      drift,
    });
  }
  return { samples, final: samples[samples.length - 1] };
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d).padStart(7);
}

function printTrajectory(s: Scenario): Sample {
  const { samples, final } = runScenario(s);
  console.log(`\n=== ${s.name} (${s.countryId}, ${s.year}) ===`);
  console.log(
    `  posture: credit=${s.creditAggressiveness} softness=${s.budgetSoftness} reformism=${s.reformism} tol=${s.tolerance} | SOE competence=${s.soeCompetence} | wageG=${s.wageGrowth} gdpG=${s.gdpGrowth}`
  );
  console.log(`  yr   turn   level  soePerf  shortage overhang  premium 2ndShare   drift`);
  const stride = TURNS_PER_YEAR; // yearly
  for (const smp of samples) {
    if (smp.turn % stride === 0 || smp.turn === samples.length) {
      console.log(
        `  ${fmt(smp.year, 1)} ${String(smp.turn).padStart(5)}  ${fmt(smp.level)}  ${fmt(
          smp.soePerf,
          2
        )}  ${fmt(smp.shortage)}  ${fmt(smp.overhang)}  ${fmt(smp.premium, 2)}  ${fmt(
          smp.secondShare,
          2
        )}  ${fmt(smp.drift, 3)}`
      );
    }
  }
  const band = final.level < 30 ? "COMMAND" : final.level < 70 ? "DUAL-TRACK" : "MARKET";
  const yearsToDual = samples.find((x) => x.level >= 30)?.turn;
  const yearsToMarket = samples.find((x) => x.level >= 70)?.turn;
  console.log(
    `  FINAL level=${final.level.toFixed(1)} band=${band}` +
      (yearsToDual
        ? ` | crossed 30 at yr+${(yearsToDual / TURNS_PER_YEAR).toFixed(1)}`
        : " | never left COMMAND") +
      (yearsToMarket ? ` | crossed 70 at yr+${(yearsToMarket / TURNS_PER_YEAR).toFixed(1)}` : "")
  );
  return final;
}

// ── Scenarios ────────────────────────────────────────────────────────────────
const RU_SECTORS: CorporationType[] = [
  "manufacturing",
  "energy",
  "extraction",
  "agriculture",
  "retail",
  "defense",
  "chemical_industries",
  "logistics",
];

const base = {
  countryId: "RU",
  year: 1953,
  sectors: RU_SECTORS,
  planTargetPerSoe: 1_000_000,
  turns: 200, // ~4.2 in-game years
};

const scenarios: Scenario[] = [
  {
    ...base,
    name: "A. Hands-off NPP (orthodox-competent default)",
    soeCompetence: 1.0,
    creditAggressiveness: 0.55, // NPP_DEFAULT_CREDIT_AGGRESSIVENESS
    budgetSoftness: 0.85, // NPP_DEFAULT_BUDGET_SOFTNESS
    reformism: 0, // NPP_DEFAULT_REFORMISM
    tolerance: 0.18, // steward default
    wageGrowth: 6,
    gdpGrowth: 4,
  },
  {
    ...base,
    name: "B. Well-run orthodox player (holds command)",
    soeCompetence: 1.0,
    creditAggressiveness: 0.5,
    budgetSoftness: 0.9,
    reformism: -0.4, // hardline
    tolerance: 0.12, // repress grey market
    wageGrowth: 5,
    gdpGrowth: 5,
  },
  {
    ...base,
    name: "C. Starved / mismanaged (should reform toward market)",
    soeCompetence: 0.72, // chronic plan misses
    creditAggressiveness: 0.2, // underfunded
    budgetSoftness: 0.3, // hard budgets
    reformism: 0.5, // reformist government
    tolerance: 0.5, // tolerated grey market
    wageGrowth: 9,
    gdpGrowth: 2,
  },
  {
    ...base,
    name: "D. Gosbank floods credit (growth up, shortage up)",
    soeCompetence: 0.9,
    creditAggressiveness: 1.0, // flood
    budgetSoftness: 0.95,
    reformism: -0.2,
    tolerance: 0.15,
    wageGrowth: 7,
    gdpGrowth: 4,
  },
  {
    ...base,
    name: "D'. Same world, RESTRAINED credit (control for D)",
    soeCompetence: 0.9,
    creditAggressiveness: 0.15, // restrained
    budgetSoftness: 0.5,
    reformism: -0.2,
    tolerance: 0.15,
    wageGrowth: 7,
    gdpGrowth: 4,
  },
  {
    ...base,
    name: "E. Realistic NPP (soePerf 0.92) — 10yr historical-tracking guard",
    soeCompetence: 0.92,
    creditAggressiveness: 0.55,
    budgetSoftness: 0.85,
    reformism: 0,
    tolerance: 0.18,
    wageGrowth: 6,
    gdpGrowth: 4,
    turns: 480, // 10 in-game years — must NOT reach market by accident
  },
  {
    ...base,
    name: "F. Total collapse (death-spiral guard: must not go instant)",
    soeCompetence: 0.5,
    creditAggressiveness: 0.1,
    budgetSoftness: 0.2,
    reformism: 0.8,
    tolerance: 0.6,
    wageGrowth: 14,
    gdpGrowth: 1,
    turns: 480,
  },
  {
    ...base,
    name: "C-long. Starved/reformist over 12yr (does it settle at market?)",
    soeCompetence: 0.72,
    creditAggressiveness: 0.2,
    budgetSoftness: 0.3,
    reformism: 0.5,
    tolerance: 0.5,
    wageGrowth: 9,
    gdpGrowth: 2,
    turns: 576, // 12 years
  },
  {
    name: "G. China 1953 hands-off NPP (should not snap to market)",
    countryId: "CN",
    year: 1953,
    sectors: [
      "manufacturing",
      "energy",
      "extraction",
      "agriculture",
      "retail",
      "chemical_industries",
    ],
    planTargetPerSoe: 1_000_000,
    soeCompetence: 0.9,
    creditAggressiveness: 0.55,
    budgetSoftness: 0.85,
    reformism: 0,
    tolerance: 0.18,
    wageGrowth: 6,
    gdpGrowth: 5,
    turns: 480,
  },
];

console.log("MARKETIZATION_DRIFT_WEIGHTS =", JSON.stringify(MARKETIZATION_DRIFT_WEIGHTS));
for (const s of scenarios) printTrajectory(s);
