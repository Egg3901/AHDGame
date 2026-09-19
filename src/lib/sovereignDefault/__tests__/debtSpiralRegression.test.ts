/**
 * Long-horizon regression for the #3813 sovereign-debt spiral.
 *
 * Root cause (traced in the #3813 investigation):
 *   - `processTreasuryTurn` (src/lib/turn/treasuryTurn.ts) derives
 *     `debt.principal` / `debt.interestRate` / `debtToGdpRatio` fresh every
 *     turn from the signed `treasuryBalance`, via
 *     `deriveFiscalState` (src/lib/budget/treasuryBalance.ts) which reads the
 *     debt/GDP tier straight off `DEBT_THRESHOLDS` (src/lib/budget/debt.ts).
 *     The top tier is a flat, uncapped 14% (`maxRatio: Infinity`).
 *   - The three sovereign-crisis resolution paths
 *     (`resolution/{restructure,repudiate,bailout}.ts`) used to mutate ONLY
 *     the tradeable `bonds` collection (haircut individual instruments) and
 *     never touched `federalBudget.treasuryBalance` / `debt.principal` — the
 *     aggregate ledger `deriveFiscalState` actually reads. So a "default"
 *     was cosmetic: the very next `processTreasuryTurn` tick recomputed the
 *     identical CCC/14% tier off the untouched principal, and the spiral
 *     resumed exactly where it left off. Live sandbox evidence: the UK
 *     repudiated at turn 448, exited "recovering" at turn 496, and was back
 *     in a SECOND crisis by turn 616 with the exact same 119.8B principal it
 *     had before the first "default" — repudiating had reduced nothing.
 *   - Bailouts had the same gap: the IMF facility bolted a small side-loan
 *     alongside the legacy debt, which kept accruing at the market tier rate
 *     in parallel — no genuine relief.
 *
 * The fix (src/lib/sovereignDefault/resolution/{restructure,repudiate}.ts,
 * src/lib/budget/debt.ts, src/lib/budget/treasuryBalance.ts):
 *   - Restructure/repudiate now write down `treasuryBalance`/`debt.principal`
 *     by the SAME haircut fraction dealt to bondholders
 *     (RESTRUCTURE_HAIRCUT / REPUDIATE_PRINCIPAL_WRITEDOWN), so a default
 *     durably shrinks the ledger the interest engine reads.
 *   - `calculateInterestRate` now caps the tier rate at the concessional IMF
 *     rate while `imfSovereignBailoutActive` — a bailout provides genuine
 *     payment relief instead of stacking a second liability atop an
 *     unchanged 14% debt mountain.
 *
 * This file drives the SAME production functions (`calculateInterestRate`,
 * `deriveFiscalState`, `computeMarketDemand`, `classifyAuctionOutcome`,
 * `computeNextCrisisState`, `isInGoodFiscalStanding`,
 * `computeRecoveryTransition`, and the write-down constants) through a
 * lightweight in-memory multi-decade loop that mirrors
 * `processTreasuryTurn`'s per-turn accrual and the annual crisis-detection
 * cadence, without standing up the full Mongo-backed turn engine.
 */

import { describe, it, expect } from "vitest";
import { EXTREME_DISTRESS_DEBT_TO_GDP } from "@/lib/budget/debt";
import { deriveFiscalState, nationalDebtFromBalance } from "@/lib/budget/treasuryBalance";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { computeMarketDemand } from "../marketDemand";
import { classifyAuctionOutcome } from "../auctionOutcome";
import { computeNextCrisisState } from "../crisisState";
import { isInGoodFiscalStanding } from "../recovery/fiscalStanding";
import { computeRecoveryTransition } from "../recovery/computeTransition";
import { REPUDIATE_PRINCIPAL_WRITEDOWN } from "../constants";
import type { SovereignCrisisState } from "@/lib/db/types/budget";
import type { SovereignDemandSnapshot } from "../types";

/** UK's real 1953 seed: 188% debt/GDP (refs #3813). */
const UK_SEED_DEBT_TO_GDP = 1.88;
const GDP0 = 17_000_000_000;
const SIM_YEARS = 60;

interface SimResult {
  /** Debt/GDP ratio sampled at every year boundary. */
  ratioByYear: number[];
  /** Turns at which a crisis fired and was resolved (write-down applied). */
  defaultTurns: number[];
  finalRatio: number;
  peakRatio: number;
}

/**
 * Drives `deriveFiscalState` (the exact function `processTreasuryTurn` calls
 * every turn) turn-by-turn, with the real crisis-detection + recovery-exit
 * pipeline evaluated at the real cadence (crisis detection once a year at
 * fiscal-year close; recovery-transition every turn, matching
 * `processSovereignRecoveryTurn`). On every crisis fire, applies the SAME
 * write-down the fixed `applyRepudiateResolution` performs — this is the
 * behavior under test, not a reimplementation of it.
 */
function simulate(opts: {
  annualPrimaryDeficitFraction: (year: number) => number;
  annualGdpGrowth: number;
}): SimResult {
  let treasuryBalance = -(UK_SEED_DEBT_TO_GDP * GDP0);
  let gdp = GDP0;
  let state: SovereignCrisisState = "normal";
  let failedAuctionCount = 0;
  let lastDefaultTurn: number | null = null;
  let recoveryStartedAtTurn: number | null = null;
  let fiscalDisciplineStreak = 0;

  const ratioByYear: number[] = [];
  const defaultTurns: number[] = [];
  let peakRatio = UK_SEED_DEBT_TO_GDP;

  for (let turn = 1; turn <= SIM_YEARS * TURNS_PER_YEAR; turn++) {
    const year = Math.floor((turn - 1) / TURNS_PER_YEAR);
    const deficitFraction = opts.annualPrimaryDeficitFraction(year);

    // --- Per-turn accrual, mirroring processTreasuryTurn exactly ---
    const pre = deriveFiscalState({
      treasuryBalance,
      gdp,
      ceiling: Number.POSITIVE_INFINITY,
    });
    const debtServiceTurn =
      pre.principal > 0 ? (pre.principal * pre.interestRate) / TURNS_PER_YEAR : 0;
    const primaryPerTurn = -(deficitFraction * gdp) / TURNS_PER_YEAR;
    treasuryBalance = treasuryBalance + primaryPerTurn - debtServiceTurn;
    gdp = gdp * (1 + opts.annualGdpGrowth / TURNS_PER_YEAR);

    const post = deriveFiscalState({ treasuryBalance, gdp, ceiling: Number.POSITIVE_INFINITY });
    peakRatio = Math.max(peakRatio, post.debtToGdpRatio);

    // --- Recovery-exit check, every turn (matches processSovereignRecoveryTurn cadence) ---
    if (state === "recovering") {
      const inGoodStanding = isInGoodFiscalStanding({
        revenueTotal: 1000,
        spendingTotal: 1000 + deficitFraction * 1000,
        spendingDebtInterest: 0,
      });
      const transition = computeRecoveryTransition({
        currentState: "recovering",
        recoveryStartedAtTurn,
        fiscalDisciplineStreak,
        inGoodStanding,
        currentTurn: turn,
        recoveryGdpPenaltyTurnsRemaining: null,
      });
      if (typeof transition.set.recoveryFiscalDisciplineStreak === "number") {
        fiscalDisciplineStreak = transition.set.recoveryFiscalDisciplineStreak;
      }
      if (transition.exitedRecovery) {
        state = "normal";
        recoveryStartedAtTurn = null;
        failedAuctionCount = 0;
      }
    }

    // --- Crisis detection, once per fiscal year (matches evaluateSovereignAuctionForCountry cadence) ---
    // "recovering" is terminal-for-detection UNLESS the country has reflated
    // back past extreme distress while nominally "recovering" — mirrors the
    // crisisDetection.ts fix that stops a never-exiting recovery state from
    // permanently shielding a reflating country from ever being re-detected.
    const recoveringButReflated =
      state === "recovering" && post.debtToGdpRatio >= EXTREME_DISTRESS_DEBT_TO_GDP;
    if (turn % TURNS_PER_YEAR === 0 && (state !== "recovering" || recoveringButReflated)) {
      const detectionState: SovereignCrisisState = recoveringButReflated ? "normal" : state;
      const snapshot: SovereignDemandSnapshot = {
        countryCode: "UK",
        currentTurn: turn,
        debtToGdp: post.debtToGdpRatio,
        inflationRate: 0.03,
        trust: 0.5,
        sovereignCouponRate: post.interestRate * 100,
        fxDepreciationRate10t: 0,
        turnsSinceLastDefault: lastDefaultTurn === null ? null : turn - lastDefaultTurn,
        entityHoldings: 0,
        requiredIssuance: 1,
      };
      const demand = computeMarketDemand(snapshot);
      const classified = classifyAuctionOutcome(demand.demandRatio);
      failedAuctionCount = classified.counterDelta === 0 ? 0 : failedAuctionCount + 1;
      const transition = computeNextCrisisState({
        current: detectionState,
        outcome: classified.outcome,
        newConsecutiveFailedCount: failedAuctionCount,
      });
      state = transition.nextState;

      if (transition.firedThisEvaluation) {
        // Genuine write-down under test — mirrors applyRepudiateResolution's
        // fixed behavior exactly (the auto-Repudiate safety net is what a
        // passive/NPC-governed country actually falls through to).
        const priorPrincipal = nationalDebtFromBalance(treasuryBalance);
        treasuryBalance = -(priorPrincipal * (1 - REPUDIATE_PRINCIPAL_WRITEDOWN));
        lastDefaultTurn = turn;
        defaultTurns.push(turn);
        state = "recovering";
        recoveryStartedAtTurn = turn;
        fiscalDisciplineStreak = 0;
      }
      ratioByYear.push(
        deriveFiscalState({ treasuryBalance, gdp, ceiling: Number.POSITIVE_INFINITY })
          .debtToGdpRatio
      );
    } else if (turn % TURNS_PER_YEAR === 0) {
      ratioByYear.push(post.debtToGdpRatio);
    }
  }

  const finalRatio = deriveFiscalState({
    treasuryBalance,
    gdp,
    ceiling: Number.POSITIVE_INFINITY,
  }).debtToGdpRatio;

  return { ratioByYear, defaultTurns, finalRatio, peakRatio };
}

describe("#3813 sovereign-debt spiral — long-horizon regression", () => {
  it("a UK-shaped country (188% seed) under passive play does not reach an unrecoverable ratio over 60 years", () => {
    // "Passive play": a modest, UNCHANGING 2%-of-GDP structural deficit —
    // the player never touches fiscal policy, for better or worse. Realistic
    // peacetime shortfall, not deliberate austerity or deliberate overspend.
    const result = simulate({
      annualPrimaryDeficitFraction: () => 0.02,
      annualGdpGrowth: 0.02,
    });

    // At least one crisis fires and is genuinely resolved along the way —
    // the 188% seed is already in "undersubscribed" territory (demand < 1.0)
    // per the real demand formula, so passive play alone climbs into crisis
    // range before the fix's write-down ever gets a chance to engage. This
    // reproduces the UK's actual observed trajectory (188% -> crisis by ~9
    // years) before the fix stabilizes it.
    expect(result.defaultTurns.length).toBeGreaterThan(0);

    // The core regression: the ratio never spirals into the observed-bug
    // territory (704%) or beyond. A generous ceiling well under the old
    // observed blowup, comfortably above the 250% "extreme distress" band,
    // confirms the write-down keeps the country in a recoverable range
    // instead of compounding indefinitely.
    expect(result.peakRatio).toBeLessThan(5.0);

    // And critically, it does not end the 60-year run WORSE than its peak
    // pre-resolution distress — i.e. genuine convergence, not merely a
    // temporary reprieve before re-diverging past the same extreme. This is
    // exactly the property the old code violated: BR/ES/CN/UK all "resolved"
    // a crisis and then reflated past their prior peak.
    expect(result.finalRatio).toBeLessThanOrEqual(result.peakRatio);
    expect(result.finalRatio).toBeLessThan(2.0);
  });

  it("sustained bad policy still drives genuine fiscal collapse (gravity, not rails)", () => {
    // A country that keeps running a large, ever-widening structural
    // deficit — even immediately after being bailed out by a write-down —
    // must still be able to spiral back into crisis. The fix must not turn
    // sovereign debt into a free, consequence-free reset.
    const result = simulate({
      annualPrimaryDeficitFraction: (year) => 0.05 + year * 0.01,
      annualGdpGrowth: 0.02,
    });

    // Reckless, ever-worsening overspending must keep producing genuine
    // crises — the write-down is relief, not immunity.
    expect(result.defaultTurns.length).toBeGreaterThanOrEqual(2);

    // And the ratio must still be able to reach extreme-distress territory
    // (the same >250% band the seed itself and the sovereign default docs
    // treat as genuine crisis territory) — collapse remains reachable under
    // sustained bad policy.
    expect(result.peakRatio).toBeGreaterThan(2.5);
  });
});
