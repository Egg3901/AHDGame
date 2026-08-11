import { describe, it, expect } from "vitest";
import {
  REQUEST_THRESHOLD,
  REFERENDUM_PASS_THRESHOLD,
  referendumRequestEligibility,
  cumulativeCampaignEffect,
  deriveCampaignYesShare,
  resolveReferendumVote,
} from "@/lib/constants/referendum";

describe("referendumRequestEligibility", () => {
  const base = {
    desire: 70,
    hasActiveReferendum: false,
    cooldownReadyAtTurn: null,
    currentTurn: 100,
  };

  it("eligible when desire ≥ threshold, no active referendum, no cooldown", () => {
    expect(referendumRequestEligibility(base).eligible).toBe(true);
  });
  it("ineligible below the desire threshold", () => {
    const r = referendumRequestEligibility({ ...base, desire: REQUEST_THRESHOLD - 1 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/desire/i);
  });
  it("ineligible while another referendum is active", () => {
    expect(referendumRequestEligibility({ ...base, hasActiveReferendum: true }).eligible).toBe(
      false
    );
  });
  it("ineligible while in cooldown", () => {
    const r = referendumRequestEligibility({ ...base, cooldownReadyAtTurn: 150, currentTurn: 120 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/cooldown/i);
  });
  it("eligible once cooldown has elapsed", () => {
    expect(
      referendumRequestEligibility({ ...base, cooldownReadyAtTurn: 150, currentTurn: 150 }).eligible
    ).toBe(true);
  });
  it("active referendum blocks even above threshold (priority over cooldown/desire)", () => {
    const r = referendumRequestEligibility({
      ...base,
      hasActiveReferendum: true,
      cooldownReadyAtTurn: 999,
      currentTurn: 100,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/in progress/i);
  });
});

describe("cumulativeCampaignEffect / deriveCampaignYesShare", () => {
  // Reference incremental spend (the cohort-cutover removed the production
  // `applyCampaignSpend`; this local copy cross-checks the bulk derivation).
  const incr = (yesShare: number, side: "yes" | "no", units: number, prior: number) => {
    const gained = cumulativeCampaignEffect(prior + units) - cumulativeCampaignEffect(prior);
    return Math.max(0, Math.min(100, yesShare + (side === "yes" ? gained : -gained)));
  };

  it("cumulative effect grows but with diminishing marginal returns", () => {
    const e1 = cumulativeCampaignEffect(1);
    const e2 = cumulativeCampaignEffect(2);
    const e3 = cumulativeCampaignEffect(3);
    expect(e1).toBeGreaterThan(0);
    expect(e2 - e1).toBeLessThan(e1); // 2nd unit adds less than the 1st
    expect(e3 - e2).toBeLessThan(e2 - e1); // and the 3rd less than the 2nd
  });

  it("derive is order-independent: equals incremental spend interleavings", () => {
    const base = 50;
    // Interleave yes/no spends in an arbitrary order.
    let y = base;
    y = incr(y, "yes", 2, 0);
    y = incr(y, "no", 1, 0);
    y = incr(y, "yes", 1, 2);
    y = incr(y, "no", 2, 1);
    const derived = deriveCampaignYesShare(base, 3, 3);
    expect(derived).toBeCloseTo(y, 6);
  });

  it("derive clamps to [0, 100]", () => {
    expect(deriveCampaignYesShare(0, 0, 1000)).toBe(0);
    expect(deriveCampaignYesShare(100, 1000, 0)).toBe(100);
  });
});

describe("resolveReferendumVote", () => {
  it("passes when final yesShare > 50", () => {
    const r = resolveReferendumVote({ yesShare: 55, varianceRoll: 0 });
    expect(r.finalYesShare).toBe(55);
    expect(r.passed).toBe(true);
  });
  it("fails when final yesShare = 50 (must exceed)", () => {
    expect(resolveReferendumVote({ yesShare: 50, varianceRoll: 0 }).passed).toBe(false);
  });
  it("applies the variance roll within the band and re-clamps", () => {
    const r = resolveReferendumVote({ yesShare: 50, varianceRoll: 1 });
    expect(r.finalYesShare).toBeGreaterThan(50);
    expect(r.finalYesShare).toBeLessThanOrEqual(100);
  });
  it("clamps an out-of-range variance roll", () => {
    const r = resolveReferendumVote({ yesShare: 98, varianceRoll: 5 });
    expect(r.finalYesShare).toBeLessThanOrEqual(100);
  });
  it("reports a turnout in (0,100]", () => {
    const r = resolveReferendumVote({ yesShare: 50, varianceRoll: 0 });
    expect(r.turnout).toBeGreaterThan(0);
    expect(r.turnout).toBeLessThanOrEqual(100);
  });
});

it("pass threshold is 50", () => {
  expect(REFERENDUM_PASS_THRESHOLD).toBe(50);
});
