import { describe, expect, it } from "vitest";
import {
  NON_PARTY_BUCKET_INDEPENDENT_BIAS,
  PASSIVE_REG_DECAY_RATE,
  PASSIVE_REG_DRIFT_RATE,
  REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT,
  STRONGHOLD_FALL_TIME_TURNS_TARGET,
} from "./pacingConstants";

describe("pacingConstants", () => {
  it("drift > decay (slow background pressure, drift dominates)", () => {
    expect(PASSIVE_REG_DRIFT_RATE).toBeGreaterThan(PASSIVE_REG_DECAY_RATE);
    // Drift dominates decay by at least an order of magnitude. The 2026-06-21
    // revert of the active Registration Drive bumped drift 0.04 → 0.06 without
    // touching decay, so the ratio went from 10× to 15×; the invariant we care
    // about is "drift outpaces decay enough for committed parties to grow Reg".
    expect(PASSIVE_REG_DRIFT_RATE / PASSIVE_REG_DECAY_RATE).toBeGreaterThanOrEqual(10);
  });

  it("rates are positive percent points", () => {
    expect(PASSIVE_REG_DRIFT_RATE).toBeGreaterThan(0);
    expect(PASSIVE_REG_DECAY_RATE).toBeGreaterThan(0);
  });

  it("rates are small per turn (days, not seconds, to move 1pp baseline)", () => {
    // 0.06% / turn → ~17 turns to move 1pp; 0.004% / turn → 250 turns
    expect(1 / PASSIVE_REG_DRIFT_RATE).toBeGreaterThanOrEqual(15);
    expect(1 / PASSIVE_REG_DECAY_RATE).toBeGreaterThanOrEqual(200);
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
});
