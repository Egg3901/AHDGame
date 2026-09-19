/**
 * reshuffleGuard pure-rule tests (#1994).
 *
 * Every case is deterministic: fixed turns, fixed shortfalls, no I/O. The
 * "old-code negative controls" assert that the pre-fix threshold-only rule
 * (`shouldReshuffleMinister`) would still fire where the guard now refuses —
 * proving the guard is what stops the churn.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateReshuffleEligibility,
  governmentKeyForReshuffle,
  isUnchangedShortfall,
  markPortfolioEscalated,
  ministerTenureTurns,
  nextPortfolioRecordOnReshuffle,
  readReshuffleGuardState,
  GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS,
  MAX_CONSECUTIVE_PORTFOLIO_RESHUFFLES,
  MIN_MINISTER_TENURE_TURNS,
  PORTFOLIO_RESHUFFLE_COOLDOWN_TURNS,
  RESHUFFLE_GUARD_CONFIG,
  SHORTFALL_STABILITY_EPSILON,
  type PortfolioReshuffleRecord,
} from "../rules/reshuffleGuard";
import { shouldReshuffleMinister } from "../ministerialGovernance";

const TURN = 100;

function record(over: Partial<PortfolioReshuffleRecord> = {}): PortfolioReshuffleRecord {
  return {
    lastReshuffleTurn: 50,
    consecutiveReshuffles: 1,
    lastShortfallAtReshuffle: 0.9,
    escalated: false,
    ...over,
  };
}

describe("guard constants (turn/year conventions)", () => {
  it("minimum tenure covers one full ministerial-order cycle", () => {
    // TURNS_PER_YEAR = 48; DEFAULT_ORDER_DURATION = 24;
    // SETTING_CHANGE_COOLDOWN_TURNS = 24. A minister needs one complete lever
    // cycle before its shortfall can be blamed on it.
    expect(MIN_MINISTER_TENURE_TURNS).toBe(24);
    expect(PORTFOLIO_RESHUFFLE_COOLDOWN_TURNS).toBe(24);
  });

  it("government cooldown is shorter than the portfolio cooldown", () => {
    expect(GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS).toBeLessThan(PORTFOLIO_RESHUFFLE_COOLDOWN_TURNS);
    expect(GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS).toBe(12);
  });

  it("escalation is bounded", () => {
    expect(MAX_CONSECUTIVE_PORTFOLIO_RESHUFFLES).toBe(2);
    expect(SHORTFALL_STABILITY_EPSILON).toBeGreaterThan(0);
  });
});

describe("ministerTenureTurns", () => {
  it("measures turns since appointment", () => {
    expect(ministerTenureTurns(76, TURN)).toBe(24);
    expect(ministerTenureTurns(100, TURN)).toBe(0);
  });

  it("waives tenure for legacy unstamped seats", () => {
    expect(ministerTenureTurns(undefined, TURN)).toBeNull();
    expect(ministerTenureTurns("76", TURN)).toBeNull();
  });

  it("clamps future stamps instead of going negative", () => {
    expect(ministerTenureTurns(120, TURN)).toBe(0);
  });
});

describe("governmentKeyForReshuffle", () => {
  it("keys on cycle, formation turn, and head", () => {
    const head = { toString: () => "headA" };
    expect(governmentKeyForReshuffle({ cycle: 3, formedTurn: 10, headNppId: head })).toBe(
      "3:10:headA"
    );
    expect(governmentKeyForReshuffle({ cycle: 4, formedTurn: 10, headNppId: head })).not.toBe(
      governmentKeyForReshuffle({ cycle: 3, formedTurn: 10, headNppId: head })
    );
  });

  it("legacy docs without cycle/turn/head still key deterministically", () => {
    expect(governmentKeyForReshuffle({})).toBe("?:?:?");
    expect(governmentKeyForReshuffle({ cycle: null, formedTurn: null, headNppId: null })).toBe(
      "?:?:?"
    );
    // A new head discriminates even when the turn parts are absent.
    expect(governmentKeyForReshuffle({ headNppId: { toString: () => "headB" } })).not.toBe(
      governmentKeyForReshuffle({})
    );
  });
});

describe("readReshuffleGuardState", () => {
  it("returns empty state when nothing is persisted", () => {
    expect(readReshuffleGuardState(undefined, "3:10:h")).toEqual({
      lastReshuffleTurn: null,
      portfolios: {},
    });
    expect(readReshuffleGuardState(null, "3:10:h")).toEqual({
      lastReshuffleTurn: null,
      portfolios: {},
    });
  });

  it("resets on government transition (key mismatch)", () => {
    const persisted = {
      governmentKey: "3:10:headA",
      lastReshuffleTurn: 90,
      portfolios: { finance: record() },
      lastReplacement: null,
    };
    expect(readReshuffleGuardState(persisted, "4:120:headB")).toEqual({
      lastReshuffleTurn: null,
      portfolios: {},
    });
  });

  it("keeps state for the same government and drops corrupt records", () => {
    const persisted = {
      governmentKey: "3:10:h",
      lastReshuffleTurn: 90,
      portfolios: { finance: record(), broken: { lastReshuffleTurn: "soon" } },
      lastReplacement: null,
    };
    const state = readReshuffleGuardState(persisted, "3:10:h");
    expect(state.lastReshuffleTurn).toBe(90);
    expect(Object.keys(state.portfolios)).toEqual(["finance"]);
  });
});

describe("evaluateReshuffleEligibility", () => {
  const base = {
    thresholdMet: true,
    tenureTurns: MIN_MINISTER_TENURE_TURNS,
    turnsSinceGovernmentReshuffle: null as number | null,
    portfolio: null as PortfolioReshuffleRecord | null,
    shortfall: 0.9,
    currentTurn: TURN,
  };

  it("allows a tenured minister with no history", () => {
    expect(evaluateReshuffleEligibility(base)).toEqual({ eligible: true, reason: "threshold" });
  });

  it("blocks a new minister below minimum tenure (old code would fire)", () => {
    // Negative control: the pre-fix threshold-only rule fires here.
    expect(shouldReshuffleMinister(0.9, 0.6)).toBe(true);
    for (const tenure of [0, 1, MIN_MINISTER_TENURE_TURNS - 1]) {
      expect(evaluateReshuffleEligibility({ ...base, tenureTurns: tenure })).toEqual({
        eligible: false,
        reason: "min-tenure",
      });
    }
  });

  it("allows exactly at minimum tenure", () => {
    expect(
      evaluateReshuffleEligibility({ ...base, tenureTurns: MIN_MINISTER_TENURE_TURNS }).eligible
    ).toBe(true);
  });

  it("waives tenure for legacy unstamped seats", () => {
    expect(evaluateReshuffleEligibility({ ...base, tenureTurns: null }).eligible).toBe(true);
  });

  it("blocks inside the government cooldown (old code would fire)", () => {
    expect(shouldReshuffleMinister(0.9, 0.6)).toBe(true);
    expect(
      evaluateReshuffleEligibility({
        ...base,
        turnsSinceGovernmentReshuffle: GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS - 1,
      })
    ).toEqual({ eligible: false, reason: "government-cooldown" });
    expect(
      evaluateReshuffleEligibility({
        ...base,
        turnsSinceGovernmentReshuffle: GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS,
      }).eligible
    ).toBe(true);
  });

  it("blocks inside the portfolio cooldown (old code would fire)", () => {
    expect(shouldReshuffleMinister(0.9, 0.6)).toBe(true);
    const portfolio = record({
      lastReshuffleTurn: TURN - (PORTFOLIO_RESHUFFLE_COOLDOWN_TURNS - 1),
    });
    expect(evaluateReshuffleEligibility({ ...base, portfolio }).eligible).toBe(false);
    expect(evaluateReshuffleEligibility({ ...base, portfolio }).reason).toBe("portfolio-cooldown");
  });

  it("blocks an unchanged structural shortfall at the escalation cap", () => {
    const portfolio = record({
      lastReshuffleTurn: 0,
      consecutiveReshuffles: MAX_CONSECUTIVE_PORTFOLIO_RESHUFFLES,
      lastShortfallAtReshuffle: 0.9,
    });
    // Same reading the replacement already failed to move: old code refires.
    expect(shouldReshuffleMinister(0.9, 0.6)).toBe(true);
    expect(evaluateReshuffleEligibility({ ...base, portfolio, shortfall: 0.9 })).toEqual({
      eligible: false,
      reason: "escalated-structural",
    });
    // Inside the stability band also counts as unchanged.
    expect(
      evaluateReshuffleEligibility({
        ...base,
        portfolio,
        shortfall: 0.9 - SHORTFALL_STABILITY_EPSILON / 2,
      }).reason
    ).toBe("escalated-structural");
  });

  it("a materially changed shortfall restarts the bounded run", () => {
    const portfolio = record({
      lastReshuffleTurn: 0,
      consecutiveReshuffles: MAX_CONSECUTIVE_PORTFOLIO_RESHUFFLES,
      lastShortfallAtReshuffle: 0.5,
    });
    expect(evaluateReshuffleEligibility({ ...base, portfolio, shortfall: 0.9 }).eligible).toBe(
      true
    );
  });

  it("below-threshold shortfalls never reach the guard", () => {
    expect(evaluateReshuffleEligibility({ ...base, thresholdMet: false }).eligible).toBe(false);
  });
});

describe("nextPortfolioRecordOnReshuffle / markPortfolioEscalated", () => {
  it("starts a fresh record on first replacement", () => {
    expect(
      nextPortfolioRecordOnReshuffle({ prior: null, shortfall: 0.9, currentTurn: TURN })
    ).toEqual({
      lastReshuffleTurn: TURN,
      consecutiveReshuffles: 1,
      lastShortfallAtReshuffle: 0.9,
      escalated: false,
    });
  });

  it("increments consecutive for an unchanged shortfall and marks escalation at the cap", () => {
    const next = nextPortfolioRecordOnReshuffle({
      prior: record({ consecutiveReshuffles: 1, lastShortfallAtReshuffle: 0.9 }),
      shortfall: 0.88,
      currentTurn: TURN,
    });
    expect(next.consecutiveReshuffles).toBe(2);
    // The cap-hitting replacement reports exhaustion immediately; the state
    // (and lastReplacement built from it) must not claim room is left.
    expect(next.escalated).toBe(true);
  });

  it("below-cap replacements are not marked escalated", () => {
    const next = nextPortfolioRecordOnReshuffle({
      prior: record({ consecutiveReshuffles: 1, lastShortfallAtReshuffle: 0.9 }),
      shortfall: 0.88,
      currentTurn: TURN,
      config: { ...RESHUFFLE_GUARD_CONFIG, maxConsecutivePortfolioReshuffles: 3 },
    });
    expect(next.consecutiveReshuffles).toBe(2);
    expect(next.escalated).toBe(false);
  });

  it("the escalated flag refuses on its own when the counter is corrupted low", () => {
    const portfolio = record({
      lastReshuffleTurn: 0,
      consecutiveReshuffles: 1,
      lastShortfallAtReshuffle: 0.9,
      escalated: true,
    });
    expect(
      evaluateReshuffleEligibility({
        thresholdMet: true,
        tenureTurns: MIN_MINISTER_TENURE_TURNS,
        turnsSinceGovernmentReshuffle: null,
        portfolio,
        shortfall: 0.9,
        currentTurn: TURN,
      })
    ).toEqual({ eligible: false, reason: "escalated-structural" });
  });

  it("custom config retunes the cap (worldsim sweep threading)", () => {
    const portfolio = record({
      lastReshuffleTurn: 0,
      consecutiveReshuffles: 1,
      lastShortfallAtReshuffle: 0.9,
    });
    const config = { ...RESHUFFLE_GUARD_CONFIG, maxConsecutivePortfolioReshuffles: 1 };
    expect(
      evaluateReshuffleEligibility({
        thresholdMet: true,
        tenureTurns: MIN_MINISTER_TENURE_TURNS,
        turnsSinceGovernmentReshuffle: null,
        portfolio,
        shortfall: 0.9,
        currentTurn: TURN,
        config,
      }).eligible
    ).toBe(false);
    expect(
      nextPortfolioRecordOnReshuffle({ prior: null, shortfall: 0.9, currentTurn: TURN, config })
        .escalated
    ).toBe(true);
  });

  it("resets to 1 and clears escalation on a materially changed shortfall", () => {
    const next = nextPortfolioRecordOnReshuffle({
      prior: record({
        consecutiveReshuffles: 2,
        lastShortfallAtReshuffle: 0.5,
        escalated: true,
      }),
      shortfall: 0.9,
      currentTurn: TURN,
    });
    expect(next).toEqual({
      lastReshuffleTurn: TURN,
      consecutiveReshuffles: 1,
      lastShortfallAtReshuffle: 0.9,
      escalated: false,
    });
  });

  it("markPortfolioEscalated keeps history and flags the portfolio", () => {
    const prior = record();
    expect(markPortfolioEscalated(prior)).toEqual({ ...prior, escalated: true });
  });

  it("isUnchangedShortfall uses the stability epsilon", () => {
    expect(isUnchangedShortfall(0.9, 0.9)).toBe(true);
    expect(isUnchangedShortfall(0.9 + SHORTFALL_STABILITY_EPSILON / 2, 0.9)).toBe(true);
    expect(isUnchangedShortfall(0.9 + SHORTFALL_STABILITY_EPSILON * 2, 0.9)).toBe(false);
  });
});
