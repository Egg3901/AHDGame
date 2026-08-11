import { describe, it, expect } from "vitest";
import { buildGovModifierByParty } from "@/lib/electionEngine/govCoattail";

/**
 * P6d GATE 3 — downstream-behavior parity. The cutover moves approval by a
 * bounded amount (≤~3 pts, GATE 2). audit-3 warns a bounded shift can still
 * FLIP a discrete downstream decision. The trace (recorded here) found that NO
 * downstream consumer keys a discrete decision off government approval:
 *   - OPS regime collapse keys off ruling-party CONFIDENCE / popularLegitimacy,
 *     not governmentApprovals (verified: no approvalRating read in onePartyState).
 *   - NPP behavior does not read government approval (no approvalRating read in
 *     src/lib/turn/npp).
 *   - Elections consume approval as a CONTINUOUS swing scalar (vote weight =
 *     appeal × reach × approval × org) and the governor/presidential coattail as
 *     a CONTINUOUS, clamped magnitude — no step functions.
 * So the only requirement is that the approval→election driver is continuous in
 * approval (a small approval change ⇒ a small, proportional driver change, no
 * discontinuity). This test pins that for the coattail magnitude; the full
 * NPP/OPS/election suites passing is the rest of the parity evidence.
 */

describe("P6d downstream parity — coattail magnitude is continuous in approval (GATE 3)", () => {
  const partyIds = new Set(["dem"]);

  it("a ±3pt approval change produces a small, proportional coattail change (no step)", () => {
    const at = (approval: number) =>
      buildGovModifierByParty({ partyId: "dem", approval }, partyIds).get("dem")!;

    // Sweep approval in 1pt steps across the cutover band; the multiplier must
    // change smoothly (bounded per-step delta), never jump.
    let prev = at(40);
    let maxStep = 0;
    for (let a = 41; a <= 60; a++) {
      const cur = at(a);
      maxStep = Math.max(maxStep, Math.abs(cur - prev));
      prev = cur;
    }
    // 1pt of approval moves the multiplier by a tiny, fixed amount — no jump.
    expect(maxStep).toBeLessThan(0.05);
  });

  it("is monotonic increasing in approval (higher approval never lowers the bonus)", () => {
    const at = (approval: number) =>
      buildGovModifierByParty({ partyId: "dem", approval }, partyIds).get("dem")!;
    for (let a = 30; a < 70; a++) {
      expect(at(a + 1)).toBeGreaterThanOrEqual(at(a));
    }
  });
});
