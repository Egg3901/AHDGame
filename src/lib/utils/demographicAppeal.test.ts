import { describe, it, expect } from "vitest";
import {
  calcAppeal,
  approvalScalar,
  APPROVAL_SCALAR_EXPONENT,
  MAX_APPEAL,
  APPEAL_POSITION_FLOOR,
  DIRECTION_BONUS_PER_AXIS,
  DIRECTION_RAMP,
  CENTER_FRACTION,
  APPEAL_POSITION_EXPONENT,
} from "@/lib/utils/demographicAppeal";

// Mirror of the endpoint-matched position-score formula in calcAppeal, so
// exact-value assertions stay correct if APPEAL_POSITION_EXPONENT is retuned.
const positionScoreOf = (positionRaw: number, gamma: number = APPEAL_POSITION_EXPONENT): number =>
  (gamma === 2 ? Math.pow(positionRaw, 2) / 100 : 25 * Math.pow(positionRaw / 50, gamma)) +
  APPEAL_POSITION_FLOOR;

describe("calcAppeal", () => {
  it("returns max position score when candidate matches group exactly", () => {
    const result = calcAppeal(0, 0, 0, 0, 0);
    // position 50^2/100 = 25, + floor 0.5, influence 0
    expect(result).toBe(25 + APPEAL_POSITION_FLOOR);
  });

  it("returns higher appeal with more political influence", () => {
    const low = calcAppeal(0, 0, 0, 0, 0);
    const high = calcAppeal(0, 0, 0, 0, 100);
    expect(high).toBeGreaterThan(low);
    // position 25 + floor 0.5 + influence (normalizeNPI(100)=1.0 × 12.5)
    expect(high).toBe(25 + APPEAL_POSITION_FLOOR + 12.5);
  });

  it("caps political influence appeal contribution at PI=100 (sqrt curve)", () => {
    const at100 = calcAppeal(0, 0, 0, 0, 100);
    const at200 = calcAppeal(0, 0, 0, 0, 200);
    // Post-rework: normalizeNPI is sqrt(min(100, max(0, pi))/100), capped at 1.0.
    // PI≥100 saturates at 1.0, so PI=200 gives identical appeal to PI=100.
    expect(at200).toBe(at100);
    // Ceiling: position 25 + floor + influence (1.0 × 12.5)
    expect(at200).toBeLessThanOrEqual(25 + APPEAL_POSITION_FLOOR + 12.5);
  });

  it("reduces appeal when candidate position differs from group", () => {
    const match = calcAppeal(0, 0, 0, 0, 50);
    const diff = calcAppeal(0, 0, 5, 5, 50);
    expect(diff).toBeLessThan(match);
  });

  it("never returns 0 — appeal has a floor even at maximum positional distance", () => {
    const result = calcAppeal(-5, -5, 5, 5, 0);
    expect(result).toBeGreaterThan(0);
    expect(result).toBe(APPEAL_POSITION_FLOOR);
    expect(result).toBeLessThanOrEqual(MAX_APPEAL);
  });

  describe("N1 — tribal-voter directional bonus", () => {
    it("right-leaning group strictly prefers right-leaning candidate over centrist", () => {
      // Right-traditional group (EP=+1, SP=+1).
      // Centrist (0, 0): closer in absolute distance, but no directional alignment.
      // Right (3, 3): farther in absolute distance, but aligned on both axes → +2x bonus.
      const centrist = calcAppeal(1, 1, 0, 0, 0);
      const rightLeaner = calcAppeal(1, 1, 3, 3, 0);
      expect(rightLeaner).toBeGreaterThan(centrist);
    });

    it("aligned candidate gets DIRECTION_BONUS per matched axis (clean fixture)", () => {
      // Group (+1, +1). Two candidates EQUIDISTANT from group on each axis
      // (distance 2 on each, positionRaw identical) but opposite signs:
      //   - oppositeSide (-1, -1): no axis aligned → bonus 0
      //   - aligned (+3, +3): both axes aligned → bonus 2 × DIRECTION_BONUS
      // The directional bonus is the ONLY difference.
      const oppositeSide = calcAppeal(1, 1, -1, -1, 0);
      const alignedSide = calcAppeal(1, 1, 3, 3, 0);
      expect(alignedSide - oppositeSide).toBeCloseTo(2 * DIRECTION_BONUS_PER_AXIS, 1);
    });

    it("single-axis alignment yields exactly one DIRECTION_BONUS", () => {
      // Group (+1, +1). Candidates equidistant on each axis but with
      // different sign patterns:
      //   - oppositeBoth (-1, -1): no axis aligned (bonus 0)
      //   - oneAxisOnly (+3, -1): EP aligned, SP opposite (bonus 1×)
      const oppositeBoth = calcAppeal(1, 1, -1, -1, 0);
      const oneAxisOnly = calcAppeal(1, 1, 3, -1, 0);
      expect(oneAxisOnly - oppositeBoth).toBeCloseTo(DIRECTION_BONUS_PER_AXIS, 1);
    });

    it("opposite-sign candidate gets no bonus (cross-party penalty)", () => {
      // Group at (+1, +1). Candidate at (-3, -3) — opposite sign on both
      // axes. No directional bonus applies.
      const oppositeSide = calcAppeal(1, 1, -3, -3, 0);
      const centrist = calcAppeal(1, 1, 0, 0, 0);
      // Centrist still beats opposite-side due to closer absolute distance,
      // AND no directional bonus differentiates them on the bonus line.
      expect(centrist).toBeGreaterThan(oppositeSide);
    });

    it("politically neutral group (EP=0, SP=0) sees no directional bonus for any candidate", () => {
      // Group at (0, 0). No direction to align with.
      const baselineCentrist = calcAppeal(0, 0, 0, 0, 0);
      const baselineRight = calcAppeal(0, 0, 3, 3, 0);
      const baselineLeft = calcAppeal(0, 0, -3, -3, 0);
      // Without directional bonus, centrist wins on absolute distance.
      // The right and left candidates are equidistant from (0, 0) and
      // should produce identical appeal (no asymmetric penalty).
      expect(baselineRight).toBeCloseTo(baselineLeft);
      expect(baselineCentrist).toBeGreaterThan(baselineRight);
    });
  });

  describe("L2 — tribal-bonus party gate", () => {
    it("no EP tribal bonus when candidate sign disagrees with party sign", () => {
      // Group leans left (EP=-2), candidate is slightly left (EP=-1) but
      // party is right (EP=+2). Cross-pressure case — must NOT get +15 EP bonus.
      const result = calcAppeal(-2, 0, -1, 0, 0, false, 2, 0);
      // diff(demoEP=-2, charEP=-1) = 1; diff(demoSP=0, charSP=0) = 0.
      // positionRaw = 50 - 1*5 - 0*5 = 45; positionScore per the γ formula.
      // No EP bonus (party disagrees), no SP bonus (group at 0).
      expect(result).toBeCloseTo(positionScoreOf(45), 10);
    });

    it("full EP tribal bonus when candidate matches both group and party signs", () => {
      // Group leans left (EP=-2), candidate is left (EP=-1), party is left (EP=-2).
      const result = calcAppeal(-2, 0, -1, 0, 0, false, -2, 0);
      // positionScore as above; EP tribal bonus +15 fires.
      expect(result).toBeCloseTo(positionScoreOf(45) + DIRECTION_BONUS_PER_AXIS, 10);
    });

    it("backwards-compat — omitting partyEP keeps current sign-match-on-group behavior", () => {
      // Same inputs as the cross-pressure case, but no party args passed.
      // Current behavior fires the EP bonus on group-sign-match only.
      const result = calcAppeal(-2, 0, -1, 0, 0, false);
      expect(result).toBeCloseTo(positionScoreOf(45) + DIRECTION_BONUS_PER_AXIS, 10);
    });
  });

  describe("L3 — continuous directional bonus through center (no zero-cliff)", () => {
    // Isolate the directional bonus on a single axis: group leans +1 on EP and
    // 0 on SP (so SP contributes no directional bonus), candidate sits at (c, 0).
    // bonus(c) = appeal − positionScore = directionFactor(c, +1) × DIRECTION_BONUS_PER_AXIS.
    const epBonusAtLean = (c: number): number => {
      const appeal = calcAppeal(1, 0, c, 0, 0);
      return appeal - positionScoreOf(50 - Math.abs(1 - c) * 5);
    };

    it("dead-center candidate earns CENTER_FRACTION of the tribal bonus (not zero)", () => {
      // The whole bug: at exactly 0 the legacy gate gave 0, sinking centrists.
      expect(epBonusAtLean(0)).toBeCloseTo(CENTER_FRACTION * DIRECTION_BONUS_PER_AXIS, 5);
    });

    it("bonus ramps linearly from CENTER_FRACTION at center to full at the ramp threshold", () => {
      const half = DIRECTION_RAMP / 2;
      // Half-way up the ramp: factor = CENTER_FRACTION + (1−CENTER_FRACTION)·0.5.
      const halfFactor = CENTER_FRACTION + (1 - CENTER_FRACTION) * 0.5;
      expect(epBonusAtLean(half)).toBeCloseTo(halfFactor * DIRECTION_BONUS_PER_AXIS, 5);
      // At and beyond the threshold: full bonus (legacy partisan calibration intact).
      expect(epBonusAtLean(DIRECTION_RAMP)).toBeCloseTo(DIRECTION_BONUS_PER_AXIS, 5);
      expect(epBonusAtLean(1)).toBeCloseTo(DIRECTION_BONUS_PER_AXIS, 5);
    });

    it("a candidate leaning away from the group earns zero once past the ramp (opposed)", () => {
      // Factor clamps to 0: a committed opponent gets no tribal amplification.
      expect(epBonusAtLean(-DIRECTION_RAMP)).toBeCloseTo(0, 5);
      expect(epBonusAtLean(-1)).toBeCloseTo(0, 5);
    });

    it("appeal is continuous across zero — equal steps give equal changes (no cliff)", () => {
      // The true "no cliff" property: on the linear ramp, equal-size position
      // steps produce ~equal-size appeal changes. The legacy binary gate made
      // the first step off (0 → 0.05) ~70× larger than the next (0.05 → 0.10).
      const step = (a: number, b: number) => calcAppeal(1, 1, b, b, 0) - calcAppeal(1, 1, a, a, 0);
      const acrossZero = step(0, 0.05);
      const aboveZero = step(0.05, 0.1);
      expect(acrossZero).toBeCloseTo(aboveZero, 1);
    });

    it("a centrist with a leaning party still earns center credit (not cross-pressured)", () => {
      // charEP 0 has no sign conflict with the party, so the L2 gate must not
      // strip the center credit. Group +1 EP, candidate centrist, party left.
      const result = calcAppeal(1, 0, 0, 0, 0, false, -2, 0);
      const positionScore = positionScoreOf(50 - 5); // diff(1,0)=1 → positionRaw 45
      expect(result).toBeCloseTo(positionScore + CENTER_FRACTION * DIRECTION_BONUS_PER_AXIS, 5);
    });
  });

  describe("soften-appeal — APPEAL_POSITION_EXPONENT (γ)", () => {
    // Neutral group (0,0) so no directional bonus; influence off. Appeal is
    // pure positionScore + floor.
    const pureAppeal = (dist: number) => calcAppeal(0, 0, dist, 0, 0, false);
    const legacyQuadratic = (positionRaw: number) =>
      Math.pow(positionRaw, 2) / 100 + APPEAL_POSITION_FLOOR;

    it("γ < 2 lifts mid-distance candidates above the legacy quadratic curve", () => {
      // Distance 5 on one axis → positionRaw 25 (midpoint). For any γ<2,
      // 25·(0.5)^γ > 25·(0.5)² — the softened curve is strictly above the
      // quadratic everywhere strictly between the endpoints.
      expect(APPEAL_POSITION_EXPONENT).toBeLessThan(2);
      expect(pureAppeal(5)).toBeGreaterThan(legacyQuadratic(25));
    });

    it("endpoints are preserved: positionRaw=0 → floor, positionRaw=50 → 25 + floor", () => {
      // Max distance (positionRaw 0): exactly the floor for any γ.
      expect(calcAppeal(-5, -5, 5, 5, 0, false)).toBe(APPEAL_POSITION_FLOOR);
      // Perfect match (positionRaw 50): 25 + floor for any γ (endpoint-matched),
      // and +12.5 influence bonus when included at PI=100.
      expect(pureAppeal(0)).toBe(25 + APPEAL_POSITION_FLOOR);
      expect(calcAppeal(0, 0, 0, 0, 100, true)).toBe(25 + APPEAL_POSITION_FLOOR + 12.5);
    });

    it("appeal is strictly monotonically decreasing in positional distance", () => {
      let prev = Infinity;
      for (let dist = 0; dist <= 10; dist += 1) {
        const a = pureAppeal(dist);
        expect(a).toBeLessThan(prev);
        prev = a;
      }
    });

    it("the formula reproduces legacy values when γ is set to 2 (formula shape)", () => {
      // The internal γ===2 branch is the exact legacy expression; verify via
      // the mirrored formula helper across the whole positionRaw range.
      for (let raw = 0; raw <= 50; raw += 5) {
        expect(positionScoreOf(raw, 2)).toBeCloseTo(legacyQuadratic(raw), 12);
        // And the general endpoint-matched branch agrees with the quadratic at γ=2.
        expect(25 * Math.pow(raw / 50, 2) + APPEAL_POSITION_FLOOR).toBeCloseTo(
          legacyQuadratic(raw),
          12
        );
      }
    });

    it("γ < 2 compresses the dynamic range vs legacy (campaign levers matter more)", () => {
      // Ratio of near-match (positionRaw 45) to far (positionRaw 5) appeal,
      // floor included, must shrink relative to the quadratic curve's ratio.
      const softRatio = positionScoreOf(45) / positionScoreOf(5);
      const legacyRatio = legacyQuadratic(45) / legacyQuadratic(5);
      expect(softRatio).toBeLessThan(legacyRatio);
    });
  });
});

describe("approvalScalar", () => {
  it("returns 0 for 0 favorability", () => {
    expect(approvalScalar(0)).toBe(0);
  });

  it("returns 1 for 100 favorability", () => {
    expect(approvalScalar(100)).toBe(1);
  });

  it("sits above the linear midpoint at 50 favorability (softening curve)", () => {
    // APPROVAL_SCALAR_EXPONENT < 1 pulls the middle of the curve UP toward 1,
    // so a mid-favorability candidate is penalised less than the old linear
    // mapping did. Endpoints are unchanged (see the 0 and 100 cases above).
    expect(approvalScalar(50)).toBeCloseTo(Math.pow(0.5, APPROVAL_SCALAR_EXPONENT), 10);
    expect(approvalScalar(50)).toBeGreaterThan(0.5);
  });

  it("compresses the spread between a popular and an unpopular candidate", () => {
    // The point of the softening: favorability stays the strongest lever but
    // stops being decisive enough that a reputation strike substitutes for
    // campaigning. Measured live case was 100 vs 38.4 → 2.60x before, ~2.15x now.
    const ratio = approvalScalar(100) / approvalScalar(38.4);
    expect(ratio).toBeLessThan(2.6);
    expect(ratio).toBeGreaterThan(1.5);
  });

  it("defaults to 50 when given null/undefined", () => {
    const atFifty = approvalScalar(50);
    expect(approvalScalar(null as unknown as number)).toBe(atFifty);
    expect(approvalScalar(undefined as unknown as number)).toBe(atFifty);
  });

  it("clamps to 0-1", () => {
    expect(approvalScalar(-10)).toBe(0);
    expect(approvalScalar(150)).toBe(1);
  });
});
