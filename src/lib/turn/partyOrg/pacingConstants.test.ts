import { describe, expect, it } from "vitest";
import {
  NON_PARTY_BUCKET_INDEPENDENT_BIAS,
  PASSIVE_REG_DECAY_RATE,
  PASSIVE_REG_DRIFT_RATE,
  REG_DECAY_LAPSE_TO_POOL_SHARE,
  REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT,
  STRONGHOLD_FALL_TIME_TURNS_TARGET,
} from "./pacingConstants";

describe("pacingConstants", () => {
  it("drift > decay (slow background pressure, drift dominates)", () => {
    expect(PASSIVE_REG_DRIFT_RATE).toBeGreaterThan(PASSIVE_REG_DECAY_RATE);
    // Drift dominates decay by at least an order of magnitude. The 2026-06-21
    // revert of the active Registration Drive bumped drift 0.04 → 0.06 and the
    // 2026-08-30 surplus-sourcing change 0.06 → 0.075, neither touching decay,
    // so the ratio is now ~19×; the invariant we care about is "drift outpaces
    // decay enough for committed parties to grow Reg".
    expect(PASSIVE_REG_DRIFT_RATE / PASSIVE_REG_DECAY_RATE).toBeGreaterThanOrEqual(10);
  });

  it("rates are positive percent points", () => {
    expect(PASSIVE_REG_DRIFT_RATE).toBeGreaterThan(0);
    expect(PASSIVE_REG_DECAY_RATE).toBeGreaterThan(0);
  });

  it("rates are small per turn (days, not seconds, to move 1pp baseline)", () => {
    // 0.075 pp / turn → ~13 turns to move 1pp; 0.004 pp / turn → 250 turns
    expect(1 / PASSIVE_REG_DRIFT_RATE).toBeGreaterThanOrEqual(12);
    expect(1 / PASSIVE_REG_DECAY_RATE).toBeGreaterThanOrEqual(200);
  });

  it("a committed party closes a Georgia-sized Org/Reg gap within 20 game days", () => {
    // Live Georgia at turn 500: GOP Org 36.5, Reg 1.0. At the 2026-08-30 bump
    // (0.06 → 0.075) that 35.5 pp climb takes ~470 turns; at 0.06 it took ~590.
    expect(35.5 / PASSIVE_REG_DRIFT_RATE).toBeLessThanOrEqual(480);
    // ...while two organised challengers pulling a 77% incumbent to Lean (<60)
    // still land inside the documented 150-300 turn stronghold-fall band.
    const turnsToLean = 17.5 / (2 * PASSIVE_REG_DRIFT_RATE);
    expect(turnsToLean).toBeGreaterThanOrEqual(100);
    expect(turnsToLean).toBeLessThanOrEqual(STRONGHOLD_FALL_TIME_TURNS_TARGET);
  });

  it("eligibility threshold is positive and below default seed Org", () => {
    expect(REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT).toBeGreaterThan(0);
    expect(REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT).toBeLessThan(15);
  });

  it("Independent bias > 1 (favors Independent over Unregistered)", () => {
    expect(NON_PARTY_BUCKET_INDEPENDENT_BIAS).toBeGreaterThan(1);
  });

  it("stronghold-fall target is in the documented 150-300 turn band", () => {
    expect(STRONGHOLD_FALL_TIME_TURNS_TARGET).toBeGreaterThanOrEqual(150);
    expect(STRONGHOLD_FALL_TIME_TURNS_TARGET).toBeLessThanOrEqual(300);
  });

  it("decay lapse share keeps both routes alive", () => {
    // Strictly between 0 and 1. At 0 the pool becomes a one-way sink again —
    // the defect that disabled the registration drive in every saturated
    // country. At 1 no rival ever inherits a lapsed registration, which
    // removes the catch-up route organised parties are meant to have.
    expect(REG_DECAY_LAPSE_TO_POOL_SHARE).toBeGreaterThan(0);
    expect(REG_DECAY_LAPSE_TO_POOL_SHARE).toBeLessThan(1);
  });
});
