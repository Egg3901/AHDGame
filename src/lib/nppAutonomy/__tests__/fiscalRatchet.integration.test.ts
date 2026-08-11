/**
 * Fiscal-ratchet regression - the one-way-debt-spiral defect (ahd_sim_g53v4,
 * turn ~451): fourteen countries given costed spending legislation had their
 * debt/GDP ratios rise every fiscal year with no reversal (CS 6%→55%,
 * BG 10%→62%, YU 15%→68%, RO 10%→62% by turn 250; CS/BG/YU/HU/PL/TR still
 * climbing at turn 350). Two confirmed causes:
 *
 *   1. `computeFiscalStance`'s debt term (`DEBT_HIGH = 1.0`) almost never won
 *      against a persistent unmet-growth agenda pull, even at the 93-115%
 *      debt/GDP the cohort actually reached (governmentFormations in the
 *      sandbox showed every one of them still reading "expansionary").
 *   2. Even when the stance DID read austere, `FISCAL_TIGHTENING_DOMAINS`
 *      (selectNppBill.ts) only covers the fiscal/tax/budget/monetary/debt
 *      domain strings - not the category ladders (healthcare, defense,
 *      education, infrastructure, welfare) that are these countries'
 *      dominant cost drivers (a single health-ladder rung swings 1-2% of
 *      GDP). The stance had no lever on the actual spending at all.
 *
 * This file proves the fix end-to-end with a small deterministic simulation
 * (no DB) rather than isolated assertions on either piece alone: a synthetic
 * government with a chronic, never-resolving "raise healthcare spending"
 * agenda item - the exact shape of the real cohort's persistent unmet-need
 * agenda - runs against a fixed revenue base for many periods, and
 * `computeFiscalStance` + `selectNppBill`'s cost-aware fiscal-restraint pick
 * (relativeCost / fiscalRestraintOption) are exercised together each period.
 */
import { describe, expect, it } from "vitest";
import type { LegislationPolicyOption, LegislationType, NPP } from "@/lib/db/types";
import type { NPPPersonality } from "@/lib/db/types/npp";
import type { GoverningAgendaItem } from "../governingAgenda";
import { computeFiscalStance } from "../fiscalStance";
import { selectNppBill, type ConditionsSignal } from "../selectNppBill";
import { nationalDebtFromBalance } from "@/lib/budget/treasuryBalance";

// Fixed GDP isolates the fiscal-policy feedback loop from GDP-growth dynamics
// (which live entirely outside fiscalStance/selectNppBill).
const GDP = 100_000_000_000;
// Everything the health ladder doesn't cover (defense, education, debt
// service, etc.) - a fixed baseline so the health ladder's own rung is what
// swings the primary balance's sign.
const OTHER_SPENDING_FRACTION = 0.3;

const noUrgency: ConditionsSignal = { weakDomains: {} };
// High ambition + low stubbornness = "reformer" (governingArchetype.ts) - the
// highest spend-appetite archetype, so the test stresses the strongest case
// for a permanent expansionary bias.
const reformerPersonality: NPPPersonality = { ambition: 80, stubbornness: 20, loyalty: 50 };
const npp = { policies: { economic: 0, social: 0 } } as NPP;

/** Mirrors the real yu_public_health_service ladder shape (5 rungs, cost
 *  monotonically increasing with effectDirection). */
function healthLadder(): LegislationType {
  const options: LegislationPolicyOption[] = [
    {
      id: "cut2",
      name: "Deep Cuts",
      stance: "right",
      effectDirection: -1,
      economic: 5,
      social: 0,
      gdpCostFraction: 0.01,
    },
    {
      id: "cut1",
      name: "Trim",
      stance: "right",
      effectDirection: -1,
      economic: 3,
      social: 0,
      gdpCostFraction: 0.02,
    },
    {
      id: "center",
      name: "Status Quo",
      stance: "center",
      effectDirection: 0,
      economic: 0,
      social: 0,
      gdpCostFraction: 0.03,
    },
    {
      id: "raise1",
      name: "Expand",
      stance: "left",
      effectDirection: 1,
      economic: -3,
      social: 0,
      gdpCostFraction: 0.04,
    },
    {
      id: "raise2",
      name: "Mobilize",
      stance: "left",
      effectDirection: 1,
      economic: -5,
      social: 0,
      gdpCostFraction: 0.05,
    },
  ];
  return {
    _id: "sim_health",
    name: "Health Ladder",
    description: "",
    policyDomain: "healthcare",
    subCategory: "",
    positions: [],
    policyOptions: options,
  } as unknown as LegislationType;
}

// A chronic, never-resolving unmet-need agenda: "poverty" feeds
// computeFiscalStance's growthPull (GROWTH_DOMAINS), "healthcare" feeds
// selectNppBill's agenda-directed pick on the ladder above. Both persist
// every period - nothing in governingAgenda.ts ever turns a "raise" into a
// "lower", by design (see governingAgenda.ts) - so the only thing that can
// ever push back on the healthcare ladder is the fiscal stance/restraint
// under test.
const chronicAgenda: GoverningAgendaItem[] = [
  { domain: "poverty", target: 65, direction: "raise", priority: 0.7 },
  { domain: "healthcare", target: 65, direction: "raise", priority: 0.9 },
];

interface SimState {
  balance: number;
}

function step(state: SimState, revenueFraction: number) {
  const debtToGdpRatio = nationalDebtFromBalance(state.balance) / GDP;
  const stance = computeFiscalStance({
    agenda: chronicAgenda,
    inflationRate: 2.0, // calm - isolates the debt channel from the inflation one
    debtToGdpRatio,
    personality: reformerPersonality,
    currentTurn: 0,
  });
  const sel = selectNppBill([healthLadder()], npp, noUrgency, chronicAgenda, stance);
  const healthCost = sel?.option.gdpCostFraction ?? 0.03;
  const spending = (OTHER_SPENDING_FRACTION + healthCost) * GDP;
  const revenue = revenueFraction * GDP;
  const primaryBalance = revenue - spending;
  state.balance += primaryBalance;
  return { debtToGdpRatio, stance, healthCost, primaryBalance };
}

describe("fiscal ratchet regression (computeFiscalStance + selectNppBill fiscal restraint)", () => {
  it("a chronically expansionary government's primary balance flips sign once its own debt crosses real distress", () => {
    const revenueFraction = 0.33;
    const state: SimState = { balance: 0 };

    let sawDeficit = false;
    let sawAusterePivot = false;
    let sawSurplusAfterDistress = false;
    let periods = 0;

    for (; periods < 2000; periods++) {
      const { stance, primaryBalance, debtToGdpRatio } = step(state, revenueFraction);
      if (primaryBalance < 0) sawDeficit = true;
      if (stance.stance === "austere") sawAusterePivot = true;
      if (sawAusterePivot && primaryBalance > 0) sawSurplusAfterDistress = true;
      if (sawSurplusAfterDistress) break;
      // The pivot should happen well inside the game's own distress ladder
      // (debt.ts tops out its rating bands at 2.5x GDP) - not require running
      // off into the extreme-distress tail to provoke a response.
      expect(debtToGdpRatio).toBeLessThan(2.5);
    }

    expect(sawDeficit).toBe(true);
    expect(sawAusterePivot).toBe(true);
    expect(sawSurplusAfterDistress).toBe(true);
    expect(periods).toBeLessThan(2000);
  });

  it("genuine sustained overspending - revenue below even the ladder's cheapest rung - still accumulates debt without limit", () => {
    // No policy choice on this ladder can close the gap (baseline alone
    // already exceeds revenue), so debt must climb monotonically the whole
    // run regardless of how austere the stance gets. "Gravity, not rails":
    // the fix must not force a reversal that the underlying fundamentals
    // don't support.
    const revenueFraction = 0.29;
    const state: SimState = { balance: 0 };

    let prevDebt = 0;
    let everDecreased = false;
    let sawAustere = false;

    for (let period = 0; period < 500; period++) {
      const { debtToGdpRatio, stance } = step(state, revenueFraction);
      if (stance.stance === "austere") sawAustere = true;
      if (debtToGdpRatio < prevDebt - 1e-9) everDecreased = true;
      prevDebt = debtToGdpRatio;
    }

    expect(sawAustere).toBe(true); // it DID react - just couldn't fully close a structural gap
    expect(everDecreased).toBe(false);
    expect(prevDebt).toBeGreaterThan(1.0); // genuinely deep in distress, not stabilized
  });
});
