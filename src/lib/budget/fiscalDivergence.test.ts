/**
 * Regression tests for the fiscal-divergence defect (owner-reported: over a
 * long autonomous/passive run, a seeded national debt retires itself and the
 * country compounds into a runaway surplus with nothing ever claiming it).
 *
 * Root cause (measured on the ahd_sim_grand53fx sandbox, US 1953-1966 /
 * turns 1-656): `economic.wageGrowth` and `economic.tradeGrowth`
 * (metricEngine/registry/economic.ts) carry a structural, PERSISTENT premium
 * over realized `economic.gdpGrowth` with no offsetting term —
 * wageGrowth adds a labor-market "tightness" bonus `(5 - unemployment) * 0.3`
 * on top of the SAME productivity basis gdpGrowth reverts to, and
 * tradeGrowth's `WORLD_TRADE_BASELINE` (2.5) floor alone typically exceeds
 * realized GDP growth. Every turn, `fiscalBaseGrowth`
 * (src/lib/turn/fiscalBaseGrowth.ts) compounds `taxBases.wagesAndSalaries` /
 * `taxableIncome` by wageGrowth and `taxBases.importValue` by tradeGrowth
 * (via `growFederalBases`, src/lib/budget/revenue.ts) — both consistently
 * above gdpGrowth, turn after turn, with no reconciliation. Observed on the
 * sandbox: US wagesAndSalaries as a share of GDP drifted from 40.0% (1953)
 * to 54.0% (1966) in just 13 in-game years, and would keep compounding past
 * 100% given enough turns. Meanwhile spending is mostly `costModelV2
 * gdpCostFraction`-priced (src/lib/budget/costs.ts), which tracks GDP 1:1 —
 * so the growing revenue share silently outpaces spending with no one having
 * made that choice, and `nationalDebtFromBalance`
 * (src/lib/budget/treasuryBalance.ts) clamps debt to zero once the treasury
 * balance crosses positive, after which debt service stops and the surplus
 * compounds further unchecked.
 *
 * The fix (src/lib/budget/revenue.ts `growFederalBases` /
 * `computeTaxBaseGdpShareBaseline`, wired in `fiscalBaseGrowth.ts`): each
 * base is still grown by its own wage/trade/GDP rate every turn as before,
 * then pulled a small fraction of the way back toward its OWN baseline share
 * of current GDP (captured once, self-healed like
 * `eraGdpPerCapitaBaseline` in nationalMetrics.ts). This is a soft pull, not
 * a hard cap or rail: a genuinely sustained, deliberate policy that keeps
 * wage/trade growth elevated for real reasons still moves the share (and the
 * fiscal position) over time — only the passive, undirected structural drift
 * is bounded.
 *
 * These tests exercise the real, exported pure functions
 * (`applyPerTurnGrowthToFederalBases`, `deriveFiscalState`,
 * `nationalDebtFromBalance`) end-to-end in a minimal stand-in for the
 * production turn pipeline (fiscalBaseGrowth → revenue → treasuryTurn).
 * Spending is modeled as a fixed fraction of current GDP — the dominant real
 * cost form (costModelV2 gdpCostFraction) — which isolates the revenue-side
 * tax-base drift this defect and fix are about. The starting budget is
 * EXACTLY balanced (no assumed deficit) so any divergence in the results
 * comes purely from the wage/trade-vs-GDP growth-rate wedge, not from an
 * arbitrary seeded gap.
 */
import { describe, it, expect } from "vitest";
import type { EconomicGrowthFactors, FederalTaxBases } from "@/lib/db/types/budget";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  applyPerTurnGrowthToFederalBases,
  computeTaxBaseGdpShareBaseline,
  type TaxBaseGravityContext,
} from "./revenue";
import { deriveFiscalState, nationalDebtFromBalance } from "./treasuryBalance";

// Fixed nominal tax rates (%), representative of a real federal budget's mix
// (close to the US 1953 seed: incomeTax 35, domesticCorporateTax 40,
// foreignCorporateTax 32, payrollTax 3, tariffs 5).
const RATES = {
  incomeTax: 35,
  domesticCorporateTax: 40,
  foreignCorporateTax: 32,
  payrollTax: 3,
  tariffs: 5,
};

function revenueFromBases(bases: FederalTaxBases): number {
  return (
    bases.taxableIncome * (RATES.incomeTax / 100) +
    bases.domesticCorporateProfits * (RATES.domesticCorporateTax / 100) +
    bases.foreignCorporateProfits * (RATES.foreignCorporateTax / 100) +
    bases.wagesAndSalaries * (RATES.payrollTax / 100) +
    bases.importValue * (RATES.tariffs / 100)
  );
}

// US-1953-seed-shaped starting tax bases and GDP (src/lib/seeds/reference/budgets.ts
// scale), and the debt/GDP the owner reported as historically correct (~71%).
const START_GDP = 387_000_000_000;
const START_BASES: FederalTaxBases = {
  taxableIncome: 135_450_000_000,
  domesticCorporateProfits: 23_220_000_000,
  foreignCorporateProfits: 7_740_000_000,
  wagesAndSalaries: 154_800_000_000,
  importValue: 23_220_000_000,
  taxableSales: 154_800_000_000,
};
const START_DEBT = 275_000_000_000; // ~71% debt/GDP, matching the owner-reported US seed.
// Spending as a constant fraction of GDP, calibrated so the starting budget is
// EXACTLY balanced (revenue == spending at turn 0) — isolating the tax-base
// drift as the only source of any later divergence.
const SPEND_GDP_FRACTION = revenueFromBases(START_BASES) / START_GDP;

// Growth rates measured on the ahd_sim_grand53fx sandbox for the US, 1955-1966
// steady state (see the module doc above): wageGrowth and tradeGrowth sit
// persistently above gdpGrowth every single year.
const FACTORS: EconomicGrowthFactors = {
  gdpGrowth: 2.0,
  wageGrowth: 2.5,
  tradeGrowth: 3.18,
  inflationRate: 1,
  lastUpdated: new Date(0),
};

interface RunResult {
  gdp: number;
  bases: FederalTaxBases;
  treasuryBalance: number;
  debt: number;
}

/**
 * Minimal stand-in for fiscalBaseGrowth → calculateFederalRevenue →
 * calculateFederalSpending → treasuryTurn, using the real production pure
 * functions where they exist. `wageBoost`, when supplied, models a sustained
 * DELIBERATE wage-boosting policy (e.g. a minimum-wage/labor act) as an extra
 * annual wageGrowth increment from a given year onward — distinct from the
 * passive default, which uses `FACTORS.wageGrowth` unmodified throughout.
 */
function runYears(opts: {
  years: number;
  gravity: boolean;
  wageBoost?: { fromYear: number; extraPct: number };
}): RunResult {
  let gdp = START_GDP;
  let bases = START_BASES;
  let treasuryBalance = -START_DEBT;
  const shareBaseline = opts.gravity ? computeTaxBaseGdpShareBaseline(bases, gdp) : {};

  const totalTurns = opts.years * TURNS_PER_YEAR;
  for (let turn = 1; turn <= totalTurns; turn++) {
    const year = Math.ceil(turn / TURNS_PER_YEAR);
    const wageGrowth =
      opts.wageBoost && year >= opts.wageBoost.fromYear
        ? FACTORS.wageGrowth + opts.wageBoost.extraPct
        : FACTORS.wageGrowth;
    const turnFactors: EconomicGrowthFactors = { ...FACTORS, wageGrowth };

    // GDP itself grows at gdpGrowth only (mirrors state.gdp / the metric engine).
    gdp = gdp * (1 + FACTORS.gdpGrowth / 100 / TURNS_PER_YEAR);

    const gravity: TaxBaseGravityContext | undefined = opts.gravity
      ? { currentGdp: gdp, shareBaseline }
      : undefined;
    bases = applyPerTurnGrowthToFederalBases(bases, turnFactors, gravity);

    const revenue = revenueFromBases(bases);
    const spending = gdp * SPEND_GDP_FRACTION;

    // Mirrors treasuryTurn.ts: live debt-service off the PRE-slice position,
    // then accrue this turn's primary balance.
    const pre = deriveFiscalState({ treasuryBalance, gdp, ceiling: Infinity });
    const debtServiceTurn =
      pre.principal > 0 ? (pre.principal * pre.interestRate) / TURNS_PER_YEAR : 0;
    const primaryPerTurn = (revenue - spending) / TURNS_PER_YEAR;
    treasuryBalance = treasuryBalance + primaryPerTurn - debtServiceTurn;
  }

  return { gdp, bases, treasuryBalance, debt: nationalDebtFromBalance(treasuryBalance) };
}

describe("fiscal divergence: passive tax-base drift vs the GDP-share gravity guardrail", () => {
  it("reproduces the defect: WITHOUT the guardrail, a balanced budget's debt fully retires itself within decades of pure passive play", () => {
    // 50 in-game years is already far beyond the owner-reported run (13.5
    // years / 650 turns) in which the bug was first caught.
    const result = runYears({ years: 50, gravity: false });
    expect(result.debt).toBe(0);
    // And the wage share of GDP has drifted well past its 1953 starting share
    // (40.0%) — the mechanism this test is characterizing.
    const wageShare = result.bases.wagesAndSalaries / result.gdp;
    expect(wageShare).toBeGreaterThan(START_BASES.wagesAndSalaries / START_GDP + 0.05);
  });

  it("fix: WITH the guardrail active, the same balanced budget's seeded debt does NOT retire itself over the same long horizon of pure passive play", () => {
    const result = runYears({ years: 50, gravity: true });
    // Debt stays real — not just "not exactly zero": it remains at least
    // comparable to the original seeded principal, nowhere near paid off.
    expect(result.debt).toBeGreaterThan(START_DEBT * 0.5);
  });

  it("fix does not neuter deliberate policy: a sustained wage-boosting policy still pays debt down substantially even with the guardrail active", () => {
    const passive = runYears({ years: 60, gravity: true });
    const deliberate = runYears({
      years: 60,
      gravity: true,
      wageBoost: { fromYear: 1, extraPct: 3 },
    });
    // Passive-with-guardrail still owes real debt after 60 years...
    expect(passive.debt).toBeGreaterThan(0);
    // ...but 60 years of a genuinely sustained, deliberate wage-boosting
    // policy clears it, and clearly outperforms the passive baseline.
    expect(deliberate.debt).toBeLessThan(passive.debt * 0.5);
  });
});
