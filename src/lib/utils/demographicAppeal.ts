/**
 * Shared demographic appeal formula for elections, polls, and NPP dropout.
 *
 * Model:
 *   • Appeal = position score (power curve, exponent APPEAL_POSITION_EXPONENT) + influence score (political influence)
 *   • Approval (favorability) scales votes at the end — voters won't support candidates they don't approve of
 *   • Political influence affects both reach (who you can reach) and appeal (credibility/visibility)
 *
 * Max appeal = 50 (position 0-25, influence 0-25 when included).
 */

import { normalizeNPI } from "./normalizeNPI";

/** Max appeal value for normalization */
export const MAX_APPEAL = 50;

/**
 * Minimum position score floor — ensures every candidate gets a non-zero
 * weight in every demographic group regardless of positional distance.
 * Prevents complete lockout of one party from any group (realistic: even the
 * most misaligned candidate still draws a small fraction of votes).
 * Value 0.5 is ~2% of the max position score of 25.
 */
export const APPEAL_POSITION_FLOOR = 0.5;

/**
 * Position-score exponent γ ("soften-appeal"). Single tuning knob for how
 * steeply positional alignment converts into appeal:
 *
 *   positionScore = (γ === 2 ? positionRaw²/100 : 25·(positionRaw/50)^γ) + floor
 *
 * γ=2 was the legacy squared curve. It gave the position term a ~50-110×
 * dynamic range across realistic candidate-group distances, which made every
 * non-ideology lever numerically irrelevant: favorability is at most a ~3×
 * scalar, Org ~2×, and persuasion drivers ~1.4× — all rounding errors next to
 * a 50×+ ideology term. γ<2 compresses that range so campaigning actually
 * moves outcomes.
 *
 * The expression is endpoint-matched: for any γ, positionRaw=0 → 0 and
 * positionRaw=50 → 25, so the overall appeal scale (MAX_APPEAL=50) is
 * unchanged and MAX_APPEAL-normalized consumers (voteCalculations.ts
 * rawPotential, pollCalculations.ts) are unaffected in scale. Setting this
 * back to 2 reproduces legacy behavior byte-identically (the γ===2 branch is
 * the exact legacy expression).
 *
 * Validation: A/B harness sweeps 2026-07-09 over 52 resolved US races. The
 * initial sweep showed every γ ∈ {1, 1.25, 1.5, 1.75} kept the 94.2%
 * winner-match rate with exactly 1 flip vs legacy. The final calibration
 * sweep picked γ=1.5 PAIRED with DIRECTION_BONUS_PER_AXIS reduced 15 → 5
 * (see that constant's doc): competitive (≤10pt) races 40.4% → 46.2%,
 * winner-match 86.5% vs 84.6% baseline. Change either constant here only,
 * and treat the pair as one calibration.
 */
export const APPEAL_POSITION_EXPONENT: number = 1.5;

/**
 * N1 — tribal-voter directional bonus per axis. Added to `positionScore`
 * for each axis (EP, SP) where the candidate's sign matches the group's
 * lean direction. Captures the tribal-voter intuition that right-leaning
 * voters prefer a right-leaning candidate over a centrist, even when the
 * centrist is closer in absolute distance.
 *
 * History: originally calibrated to 15 per axis (max +30 when both axes
 * align) via the N2 sim calibration sweep against the legacy γ=2 (squared)
 * position curve — at 15 the centrist-vs-extremist scenario (Scenario 6)
 * landed at +38pt, in the 30-40pt target range; lower values (7.5, 10)
 * didn't bring the blowout down far enough. See
 * `2026-05-22-nominal-share-appeal-tribal-recalibration.md`.
 *
 * Recalibrated 2026-07-09 alongside APPEAL_POSITION_EXPONENT = 1.5
 * ("soften-appeal"): with the position term's dynamic range compressed, the
 * old flat +15/axis bonus came to dominate positioning, and the A/B sweep
 * showed 15/axis erased the competitiveness gain the softer exponent was
 * meant to buy. 5 per axis (bonus scale 0.33) was the only combination in
 * the sweep that moved competitive share (races within 10pt: 40.4% → 46.2%)
 * while keeping winner-match ABOVE baseline (86.5% vs 84.6%; 52-race
 * resolved gov+senate corpus, turn 979). The two constants are a paired
 * calibration: restoring legacy behavior means BOTH γ=2 AND bonus=15.
 *
 * Effect: in a right-leaning group (EP=+1, SP=+1), a right-leaning
 * candidate at (+3, +3) now gets +2×bonus positionScore that a centrist
 * at (0, 0) doesn't, partially offsetting the centrist's squared-distance
 * advantage. The centrist still wins ideologically neutral groups
 * (no directional alignment available there).
 *
 * Edge cases:
 *   - Group at exactly 0 on an axis: no directional preference; no bonus
 *     applies for any candidate on that axis. Reduces to current behavior
 *     in politically neutral groups (correct — they're effectively all
 *     swing voters).
 *   - Candidate at exactly 0 on an axis: pure centrist on that axis;
 *     gets no bonus but also no penalty. Their cross-appeal is intact
 *     via the absolute-distance term.
 */
export const DIRECTION_BONUS_PER_AXIS = 5;

/**
 * Ramp half-width for the directional bonus. A candidate's per-axis lean reaches
 * full tribal alignment once `|position| >= DIRECTION_RAMP`. Tied to the game's
 * own "Centrist vs leaning" label threshold (`roundLabelBucket` in
 * `src/lib/utils/politics.ts`: `|value| < 0.5` buckets to 0 = "Centrist"/"Moderate").
 */
export const DIRECTION_RAMP = 0.5;

/**
 * Directional-bonus fraction a *dead-center* candidate (axis at exactly 0) earns
 * in a leaning group: "acceptable to all, champion of none." The per-axis factor
 * ramps linearly from `CENTER_FRACTION` at center → 1.0 (full) when aligned at
 * the ramp threshold → 0 when opposed past it. Removes the old binary zero-cliff
 * where a candidate at exactly 0 forfeited the bonus in every group. Chosen as
 * 1/3 ("mid-pack") so centrists are no longer punished while genuine partisans
 * keep their stronghold edge. See
 * `docs/superpowers/specs/2026-06-05-centrist-appeal-cliff-design.md`.
 */
export const CENTER_FRACTION = 1 / 3;

/**
 * Compute raw appeal from policy alignment and political influence.
 * Does NOT include favorability — that scales votes at the end.
 *
 * @param demoEP - Group economic lean (-5 to +5)
 * @param demoSP - Group social lean (-5 to +5)
 * @param charEP - Candidate economic position (-5 to +5)
 * @param charSP - Candidate social position (-5 to +5)
 * @param politicalInfluence - clamped to [0, 100] by normalizeNPI; sqrt curve maps to a 0-1 multiplier
 * @param includeInfluenceInAppeal
 *   true  → presidential elections: NPI adds up to 25 pts to appeal (national recognition as persuasion)
 *   false → state elections: NPI is reach-only (name recognition = who you reach, not how persuasive)
 * @returns Appeal score ≥ APPEAL_POSITION_FLOOR (approaches 0 but never reaches it)
 */
export function calcAppeal(
  demoEP: number,
  demoSP: number,
  charEP: number,
  charSP: number,
  politicalInfluence: number,
  includeInfluenceInAppeal: boolean = true,
  partyEP?: number,
  partySP?: number
): number {
  const diff = (a: number, b: number) => Math.abs(a - b);
  const positionRaw = Math.max(0, 50 - diff(demoEP, charEP) * 5 - diff(demoSP, charSP) * 5);
  // Floor ensures appeal never reaches exactly 0 — distant candidates still draw
  // a small fraction of votes rather than being completely locked out of any group.
  //
  // γ = APPEAL_POSITION_EXPONENT softens the legacy squared curve (see the
  // constant's doc comment). Endpoint-matched: 0 → 0, 50 → 25 for any γ; the
  // γ===2 branch is the byte-identical legacy expression.
  const positionScore =
    (APPEAL_POSITION_EXPONENT === 2
      ? Math.pow(positionRaw, 2) / 100
      : 25 * Math.pow(positionRaw / 50, APPEAL_POSITION_EXPONENT)) + APPEAL_POSITION_FLOOR;
  // N1/L3 — tribal-voter directional bonus, continuous through center.
  // Per axis the bonus scales by a factor that ramps from CENTER_FRACTION at a
  // dead-center position → 1.0 once the candidate leans `>= DIRECTION_RAMP` the
  // group's way → 0 when leaning past the threshold the opposite way. This
  // removes the legacy binary zero-cliff (a candidate at exactly 0 used to
  // forfeit the bonus in every group). A neutral group (lean 0) still grants no
  // bonus to anyone.
  //
  // L2 party gate: when `partyEP`/`partySP` are provided and a *leaning*
  // candidate disagrees in sign with their party on that axis, the party machine
  // won't amplify them — the directional bonus is suppressed to 0 on that axis.
  // A centrist (charAxis 0) has no sign conflict, so it keeps its center credit.
  // Omitting the party args preserves the legacy group-only behavior.
  const directionFactor = (demoAxis: number, charAxis: number, partyAxis?: number): number => {
    if (demoAxis === 0) return 0;
    if (
      partyAxis !== undefined &&
      partyAxis !== 0 &&
      charAxis !== 0 &&
      Math.sign(partyAxis) !== Math.sign(charAxis)
    ) {
      return 0;
    }
    // Signed lean strength saturating at ±DIRECTION_RAMP, projected onto the
    // group's lean direction: +1 fully aligned, 0 centrist, -1 fully opposed.
    const lean = Math.max(-1, Math.min(1, charAxis / DIRECTION_RAMP));
    const align = lean * Math.sign(demoAxis);
    return Math.max(0, Math.min(1, CENTER_FRACTION + (1 - CENTER_FRACTION) * align));
  };
  const directionBonus =
    DIRECTION_BONUS_PER_AXIS *
    (directionFactor(demoEP, charEP, partyEP) + directionFactor(demoSP, charSP, partySP));
  // normalizeNPI caps at 2.0, so scaling by 12.5 keeps the influence
  // contribution within the 0-25 range promised by the docstring (and the
  // MAX_APPEAL=50 combined ceiling). Previously scaled by 25, which silently
  // allowed appeal to reach 75 for high-influence candidates.
  const influenceScore = includeInfluenceInAppeal ? normalizeNPI(politicalInfluence) * 12.5 : 0;
  return positionScore + directionBonus + influenceScore;
}

/**
 * Softening exponent on the approval scalar ("marginally less decisive
 * favorability"). `scalar = (fav/100)^γ`, γ < 1, so the curve is pulled up
 * toward 1 in the middle while both endpoints are preserved exactly:
 * 0 → 0 and 100 → 1.
 *
 * Why a power curve rather than a floor (`a + (1-a)·fav/100`): the floor shape
 * breaks the documented rule that 0% favorability means 0 votes
 * (`voteDistribution.test.ts` "zero favorability candidate gets effectively no
 * votes", and the wiki's demographics page). A power curve compresses the
 * spread while leaving that endpoint intact.
 *
 * Effect on the measured live case (1956 US president, 100 vs 38.4):
 * the multiplier spread falls from **2.60x to 2.15x**, a ~17% reduction —
 * deliberately marginal. Favorability stays the strongest single lever; it
 * just stops being decisive enough that a coordinated reputation strike
 * substitutes for campaigning. Paired with a raised cost on the ±1 influence
 * actions and a per-turn aggregate backstop, plus strengthened political
 * operations, so the weight lost here moves to levers that cost money and
 * planning rather than clicks.
 *
 * Calibration guard: `voteDistribution.test.ts` "balance: favorability impacts
 * vote share" requires an 80-vs-20 matchup to stay above a 2.5x ratio. At
 * γ = 0.8 that lands at **3.03x** (was 4.0x), so the calibrated relationship
 * survives. γ below ~0.62 breaks it. Treat 0.8 as the floor for this knob,
 * not a midpoint.
 */
export const APPROVAL_SCALAR_EXPONENT = 0.8;

/**
 * Approval scalar: 0% favorability = 0 votes, 100% = full votes.
 * "If voters don't approve of you they won't vote for you."
 *
 * @param favorability - 0-100
 * @returns Multiplier 0-1
 */
export function approvalScalar(favorability: number): number {
  const normalized = Math.max(0, Math.min(1, (favorability ?? 50) / 100));
  return Math.pow(normalized, APPROVAL_SCALAR_EXPONENT);
}

// Retired 2026-06-18 (D3): `partyOrgScalar` (1.0–1.6×) and
// `partyOrgScalarPresidential` (1.0–2.5×) soft Org multipliers. General
// elections and polls now use `normalizedOrgShare` (party's normalized state
// Org share, `[0, 1]`); primaries use a uniform neutral `1×` (intra-party Org
// cancels). The election engines' former "no Org data" fallback that returned
// these scalars at 1.0× is now an explicit neutral `1×`. See
// docs/superpowers/specs/2026-06-18-party-org-reg-balancing-design.md.
