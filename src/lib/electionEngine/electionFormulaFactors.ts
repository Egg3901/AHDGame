/**
 * Default Support value seeded on candidate entry (per design doc §3.1
 * "written on candidate entry — defaulted to a calibration constant per
 * Phase 4 kickoff"). Chosen at 50 so `supportMoodMultiplier(50) = 1.0×` —
 * a fresh candidate enters at neutral mood and only campaign actions /
 * scandals / endorsements push it off baseline.
 */
export const DEFAULT_CANDIDATE_SUPPORT = 50 as const;

/**
 * Per-turn Support decay rate applied while the election is `active`
 * (regression toward the neutral midpoint 50). Values move 0.5 units per
 * turn toward 50 — enough to make actions repeat-able but not so fast
 * that a single-shot rally is wasted on a long primary calendar.
 */
export const SUPPORT_DECAY_PER_TURN = 0.5 as const;

// ─── Phase B Support mutation calibration ───────────────────────────────────
//
// Constants for the action paths that move `electionCandidates.support`
// off its 50 baseline. See `2026-05-22-swing-flow-driver-activation.md`
// §B0 — these values are calibration knobs, not invariants; the [tuning
// re-pass](docs/plans/archive/2026-05/2026-05-22-driver-tuning-repass.md)
// will re-examine each after Phase B has live-race data.

/**
 * Total Support "worth" of one rally event at the neutral race-family
 * scalar (1.0× = presidential). Per the design doc, the value is
 * distributed as 60% immediate this-turn / 40% spread over future
 * turns. Subject to the per-race-family scalar — a state-senate rally's
 * effective `R` is `0.2 × SUPPORT_RALLY_FULL_VALUE`, etc.
 */
export const SUPPORT_RALLY_FULL_VALUE = 10 as const;

/** Share of a rally's full value applied immediately on the turn it fires. */
export const RALLY_IMMEDIATE_SHARE = 0.6 as const;

/**
 * How many turns the remaining (1 − RALLY_IMMEDIATE_SHARE) of a rally's
 * value is spread across. Per-turn drip = `(1 − immediate) × R / spread_turns`.
 */
export const RALLY_SPREAD_TURNS = 4 as const;

/**
 * Action cost of a one-shot rally for a presidential campaign. Per-race-
 * family scalar applies — smaller races pay proportionally less.
 */
export const SUPPORT_RALLY_ACTION_COST = 20 as const;

/**
 * Action cost of a per-turn rally-tour tick. ~50% of one-shot at the
 * presidential baseline — a tour is cheaper per tick but consumes every
 * turn it's active. Per-race-family scalar applies.
 */
export const SUPPORT_RALLY_TOUR_TICK_ACTION_COST = 10 as const;

/**
 * Support penalty when a scandal lands on a character with an active
 * candidate row. Scandal severity tiers (when wired) can multiply this
 * base.
 */
export const SUPPORT_SCANDAL_PENALTY = 10 as const;

/**
 * Support bump when an endorsement lands on a candidate. One-shot —
 * the endorsement's vote-time multiplier persists separately. Revoking
 * the endorsement reverses this bump by the same amount.
 */
export const SUPPORT_ENDORSEMENT_BUMP = 3 as const;

/**
 * Support bump for a debate win. Debate resolution currently applies
 * favorability deltas only; this constant is not consumed on that path.
 */
export const SUPPORT_DEBATE_WIN_BUMP = 4 as const;

/**
 * Phase 5a formula factors for general-election vote distribution.
 *
 * Implements the three signals committed by Phase 0.5 §7.3.2's general-election
 * formula contract — Org as normalized state share, Reg as persuasion
 * resistance, Support as candidate-level mood.
 *
 * Pure functions; safe for both server and client. Bounds and curves chosen
 * for tunability - the Balance Appendix records calibration tweaks rather
 * than this file. Backward-compat: every helper returns a neutral value
 * when its input is `undefined` (unseeded Reg / Support rows).
 *
 * See plan §"Phase 5a — Decisions Recorded During Execution" D4-D5.
 */

/**
 * Org as the party's normalized share of the total state-level Organization.
 *
 * Replaces the legacy `partyOrgScalar(org)` (`1.0–1.6×` multiplier) with a
 * pool-share interpretation — each party gets `org[partyId] / Σorg`. This
 * matches Phase 0.5 §7.3.2's `nominal_share = StatePartyOrg.organization × ...`
 * line and the plan's acceptance criterion "Organization as a normalized
 * 100% pool share in the state / region."
 *
 * Edge cases:
 *   - Total Org = 0 → return 0 (no party has any presence).
 *   - Single party in state → return 1 (full share).
 *   - Party not in map / has 0 Org → return 0.
 *   - Negative Orgs treated as 0 (defensive against bad data).
 *
 * @returns Number in `[0, 1]`. Sum across all parties present in the map = 1
 *          when the total is positive.
 */
export function normalizedOrgShare(orgByParty: Map<string, number>, partyId: string): number {
  const ownOrg = Math.max(0, orgByParty.get(partyId) ?? 0);
  let total = 0;
  for (const value of orgByParty.values()) {
    total += Math.max(0, value);
  }
  if (total <= 0) return 0;
  return ownOrg / total;
}

/**
 * Exponent applied to the normalized Org share when it enters the vote weight.
 * `< 1` gives diminishing returns - doubling Org less-than-doubles weight -
 * which softens a dominant party's structural Org edge. `0.2` is the tuned
 * value (a 3:1 Org lead yields ~1.25:1 weight); `1.0` would reproduce the
 * legacy linear share.
 */
export const ORG_WEIGHT_EXPONENT = 0.2;

/**
 * Org's contribution to a candidate's vote weight: the party's normalized
 * state Org share raised to `ORG_WEIGHT_EXPONENT` (diminishing-returns curve).
 *
 * Edge cases mirror the engines' contract:
 *  - No Org data anywhere in the state (empty / all-zero map) → neutral `1`
 *    (don't zero the whole field on unseeded worlds / test fixtures).
 *  - A party with 0 Org in a populated state → `0` (no presence → no weight;
 *    the gate is preserved, and swing-flow's `personalOrgFloor` still applies
 *    on top where wired).
 */
export function orgVoteWeight(orgByParty: Map<string, number>, partyId: string): number {
  let total = 0;
  for (const value of orgByParty.values()) total += Math.max(0, value);
  if (total <= 0) return 1; // no Org data anywhere → neutral fallback
  const share = Math.max(0, orgByParty.get(partyId) ?? 0) / total;
  return Math.pow(share, ORG_WEIGHT_EXPONENT);
}

/**
 * Maximum org-equivalent a candidate can reach from pure personal pull (no
 * party machinery). Well below a real party's normalized org share, so building
 * party organisation remains the path to winning; this only rescues ~0-org
 * candidates from a literal zero. See #0671.
 */
export const PERSONAL_ORG_FLOOR_CAP = 0.1;

/**
 * A candidate's personal "ground game" floor on effective org, from their own
 * pull: reach (√influence, 0–1) × approval (favorability/100, 0–1). Independent
 * of party org, so a genuinely-supported candidate is never zeroed by 0 party
 * organisation. Returns 0 when either input is 0; negatives clamped to 0.
 */
export function personalOrgFloor(reach: number, approval: number): number {
  return PERSONAL_ORG_FLOOR_CAP * Math.max(0, reach) * Math.max(0, approval);
}

/**
 * Minimum vote-weight reach after `normalizeNPI` / presidential-primary reach
 * curves. Equivalent to √(1/100) = PI≈1 on the state sqrt curve.
 *
 * Without this, PI=0 → reach=0 → weight=0 → the candidate accumulates literally
 * zero votes and looks "removed" from the race (ticket #1034). NPPs already
 * floor at PI=10 via `NPP_POLITICAL_INFLUENCE_FLOOR`; players can sit at 0
 * (fresh characters, neglected campaigning). The floor keeps them visible as a
 * steep disadvantage, not an erasure — same "never literally hit zero" intent
 * as {@link personalOrgFloor} / #0671. Downstream zeros (approval=0,
 * regimeMult=0 for banned OPS parties) still erase a candidate.
 */
export const VOTE_REACH_FLOOR = Math.sqrt(1 / 100);

/** Clamp a normalized reach into [VOTE_REACH_FLOOR, ∞). */
export function applyVoteReachFloor(reach: number): number {
  return Math.max(VOTE_REACH_FLOOR, reach);
}

/**
 * Personal-stat (politicalInfluence / favorability) tenure fatigue —
 * the nominal-share-side counterpart to `partyTenureFatiguePenalty`
 * (see `partyTenureFatigue.ts`).
 *
 * Root-cause context: politicalInfluence and favorability grow every turn a
 * character/NPP campaigns (Campaign: flat +1%/action; Advertise: +3 base,
 * floored at +1) but only DECAY toward a floor (PI: 0.75% of current per
 * turn) or above a fixed threshold (favorability: only above 60). Neither
 * has the mean-reverting design `electionCandidates.support` already uses
 * (regresses to 50 every active-election turn, cleared on resolution).
 * Net effect: any character who keeps campaigning asymptotically pins near
 * the 100 cap (decay is negligible next to a single action's flat gain, even
 * right at the cap: 0.75 decay vs 1.0 gain), while a non-campaigning rival
 * decays toward the floor — a permanent, non-shrinking separation that
 * re-arms every election because neither stat is per-cycle-reset like
 * Support is. Confirmed on the 654-turn `ahd_sim_grand53fx` world: the
 * recurring president carried a 3.6x politicalInfluence gap (36.1 vs 10) and
 * a +28-point favorability gap over a challenger who never held the office.
 *
 * This channel bypasses the ±10pt `INCUMBENCY_SHIELD_MAX` cap entirely — PI
 * and favorability feed `appealWeight`'s `reach` and `approval` terms
 * directly, with no tenure-awareness of their own. Compressing the terms'
 * CURVES (e.g. giving `approvalScalar` a diminishing-returns shape) was
 * evaluated and rejected: the existing balance tests
 * (`voteDistribution.test.ts` "balance: favorability impacts vote share")
 * deliberately calibrate a large *single-election* favorability or PI gap
 * (60-80 points) to a decisive (~4-9x) advantage, and the real-world gaps
 * measured above (26-28 points) sit BELOW that calibrated range — so any
 * cap loose enough to preserve the calibrated single-election tests is too
 * loose to touch the actual bug, and any cap tight enough to touch the bug
 * breaks the calibrated tests. There is no viable magnitude-based threshold.
 *
 * The actual defect is not "a large gap is unfair" (a genuinely popular
 * first-term candidate SHOULD win decisively) — it's that the SAME party
 * carries the SAME gap into every election for 12 years straight because
 * nothing about the gap is tenure-aware. So — like the swing-side
 * incumbency driver already does via `partyTenureFatiguePenalty` — this
 * erodes the tenure-holder's effective PI/favorability by a fixed number of
 * points per consecutive term beyond the first, gated on tenure data that's
 * only present for single-winner races with tracked incumbency (US
 * President via `incumbentConsecutiveTerms`, US Senate via
 * `legislativeIncumbentTenureTerms`). Absent tenure data (first term, open
 * seat, or a race family with no individual-tenure tracking, e.g. US House's
 * multi-seat aggregate) this is a complete no-op — existing single-election
 * balance tests are unaffected.
 */
export const PERSONAL_STAT_TENURE_FATIGUE_PER_TERM = 10;
export const PERSONAL_STAT_TENURE_FATIGUE_MAX = 100;

export function personalStatTenureFatigue(consecutiveTerms: number | undefined): number {
  if (consecutiveTerms == null || !Number.isFinite(consecutiveTerms)) return 0;
  const termsBeyondFirst = Math.max(0, Math.floor(consecutiveTerms) - 1);
  return Math.min(
    PERSONAL_STAT_TENURE_FATIGUE_MAX,
    termsBeyondFirst * PERSONAL_STAT_TENURE_FATIGUE_PER_TERM
  );
}

/**
 * Reg as persuasion-resistance multiplier — entrenched voters defend their
 * party against peeling. Higher own-Reg → larger multiplier on this party's
 * weight in the demographic-group split.
 *
 * Curve: linear `1 + 0.3 × (reg / 100)`, clamped to `[1.0, 1.3]`.
 *   - reg = 0  → 1.0× (no resistance, baseline)
 *   - reg = 50 → 1.15×
 *   - reg = 100 → 1.3× (max resistance)
 *
 * Backward-compat: undefined / NaN / negative reg returns 1.0× (neutral).
 * This matches the bootstrap-deferred state where most rows have
 * `registration: undefined`.
 *
 * The bounds are intentionally modest. Reg is "slow partisan baseline" per
 * Phase 0.5 §4.2 — not a wall against persuasion, just a tilt. A much
 * stronger curve (e.g. up to 2× at full Reg) would deny insurgent campaigns
 * the ability to flip a state through cumulative effort.
 */
export const REG_RESISTANCE_MAX_BONUS = 0.3;
export function regResistanceMultiplier(reg: number | undefined): number {
  if (reg == null || !Number.isFinite(reg) || reg <= 0) return 1.0;
  const clamped = Math.min(100, reg);
  return 1 + REG_RESISTANCE_MAX_BONUS * (clamped / 100);
}

/**
 * Support as candidate-level mood multiplier. Captures short-term momentum
 * — recent debate performance, scandals, endorsements — that boosts or
 * dampens the candidate's appeal independent of the party's Reg / Org.
 *
 * Curve: `0.6 + 0.8 × (support / 100)`, clamped to `[0.6, 1.4]`.
 *   - support = 0   → 0.6× (heavy penalty)
 *   - support = 50  → 1.0× (neutral, default for new candidates)
 *   - support = 100 → 1.4× (peak momentum)
 *
 * Backward-compat: undefined / NaN support returns 1.0× (neutral) so
 * rows without a Support value are not penalized.
 *
 * The asymmetry — Support penalty (0.4) is half the bonus (0.4) but
 * starting from below baseline — is intentional: scandalous candidates
 * lose votes meaningfully but the formula doesn't zero them out. They
 * still get 0.6× of their appeal-weighted share, leaving room for a
 * comeback within the same election cycle.
 */
export const SUPPORT_MOOD_FLOOR = 0.6;
export const SUPPORT_MOOD_CEILING = 1.4;
export function supportMoodMultiplier(support: number | undefined): number {
  if (support == null || !Number.isFinite(support)) return 1.0;
  const clamped = Math.max(0, Math.min(100, support));
  return SUPPORT_MOOD_FLOOR + (SUPPORT_MOOD_CEILING - SUPPORT_MOOD_FLOOR) * (clamped / 100);
}

/**
 * Party-baseline registration-share multiplier — seeded partisan baseline as
 * a structural vote-weight scalar, distinct from `regResistanceMultiplier`
 * (which models Reg only as a small 1.0-1.3× persuasion-resistance tilt).
 *
 * Motivation (1953 sim forensics): seeded polling entered the vote kernel only
 * through Org's `share^0.2` curve, so a 2.5%-polling party (1951 Liberals) paid
 * a mere ~0.66× penalty vs a ~49% party and landed at ~24% of the vote. This
 * multiplier makes the seeded partisan baseline bite: weight scales by
 * `share^REG_BASELINE_EXPONENT` (concave — sqrt by default), so 2.5%
 * registration ≈ 0.16× while 45-50% registration ≈ 0.67-0.71×; after
 * normalization a 2.5% party lands in single digits, not the twenties.
 *
 * Input is `statePartyOrg.registrationShare` (0-100) — a SEED-authored share
 * of the region's partisan electorate, written today only by the UK org
 * calculation path from era polling tables. It is deliberately a separate
 * field from `registration`:
 *
 *   COMPATIBILITY CONTRACT — returns exactly 1.0 when the share is
 *   undefined/NaN. Every world without seeded `registrationShare` rows (all
 *   already-running worlds, and every US/DE/JP/... world — the US lanes seed
 *   `registration` but never `registrationShare`) is byte-identical. This
 *   also guarantees the US `registration` lane (regResistance + peel curves)
 *   is never double-counted here, and the healthy ~55/45 US House shares are
 *   untouched.
 *
 * Parties present in a seeded region but with a 0-share row (e.g. SNP's 0.3%
 * in 1951 Scotland, seeded 0) are floored at `REG_BASELINE_MIN_SHARE` rather
 * than hard-zeroed — the Org gate and appeal still decide the rest.
 * Player-created parties never get a seeded row → neutral 1.0 (no permanent
 * hidden penalty; building Org remains their path).
 */
export const REG_BASELINE_EXPONENT = 0.5;
export const REG_BASELINE_MIN_SHARE = 0.005;
export function regBaselineMultiplier(regShare: number | undefined): number {
  if (regShare == null || !Number.isFinite(regShare)) return 1.0;
  const pct = Math.max(0, Math.min(100, regShare));
  const share = Math.max(REG_BASELINE_MIN_SHARE, pct / 100);
  return Math.pow(share, REG_BASELINE_EXPONENT);
}

// ─── §7.3.2 swing-flow curves ───────────────────────────────────────────────
//
// T3 calibration (2026-05-23 simulation harness G5 finding): the
// previous T2 values (transferable floor 0.05, resistance ceiling 0.70)
// produced ~13× peel-rate falloff between Reg=0 and Reg=100 — strong
// enough that a high-Reg incumbent could win the electoral count while
// losing the popular vote in close cycles. Softened to:
//
//   - Newcomer parties (Reg ≈ 0): ~20% transferable, 0% resistance →
//     ~20% effective peel (unchanged, newcomers stay highly peelable).
//   - Entrenched parties (Reg ≈ 100): ~10% transferable, ~50% resisting
//     → ~5% effective peel (was 1.5% in T2). High-Reg parties still
//     have a meaningful structural edge but it's a tilt, not a wall.
//   - The crossover still happens around Reg=40-60. Quadratic shape
//     preserved.
//
// Numbers verifiable in voteDistributionSwingFlow.test.ts under
// "transferableShare curve" / "persuasionResistance curve".

/**
 * Maximum share of a party's nominal vote that can be peeled by
 * persuasion in one election. Per §7.3.2, higher own Reg = larger
 * absolute pool (more voters present) but smaller transferable fraction
 * (entrenched). Quadratic shape, concave down:
 *
 *   transferable_share(0)   = 0.20
 *   transferable_share(50)  = 0.20 + (0.10−0.20) × (50/100)^1.5 ≈ 0.165
 *   transferable_share(100) = 0.10
 *
 * Backward-compat: undefined / NaN / negative reg returns 0.20 (the
 * "no Reg data" baseline matches the bootstrap-deferred state).
 */
export const TRANSFERABLE_SHARE_NO_REG = 0.2;
export const TRANSFERABLE_SHARE_FULL_REG = 0.1;
const TRANSFERABLE_SHARE_EXPONENT = 1.5;
export function transferableShare(reg: number | undefined): number {
  if (reg == null || !Number.isFinite(reg) || reg < 0) return TRANSFERABLE_SHARE_NO_REG;
  const clamped = Math.min(100, reg);
  const t = Math.pow(clamped / 100, TRANSFERABLE_SHARE_EXPONENT);
  return TRANSFERABLE_SHARE_NO_REG + (TRANSFERABLE_SHARE_FULL_REG - TRANSFERABLE_SHARE_NO_REG) * t;
}

/**
 * Fraction of the transferable pool that actually resists peeling. Higher
 * own Reg = higher resistance. Net peelable = transferable_share × (1 − persuasionResistance).
 * Quadratic shape, concave up:
 *
 *   persuasionResistance(0)   = 0.00
 *   persuasionResistance(50)  = 0.50 × (50/100)^2 = 0.125
 *   persuasionResistance(100) = 0.50
 *
 * Combined with `transferableShare`, the effective peelable share runs:
 *
 *   eff_peel(0)   = 0.20 × 1.00  = 0.200
 *   eff_peel(50)  ≈ 0.165 × 0.875 ≈ 0.144
 *   eff_peel(100) = 0.10 × 0.50  = 0.050
 *
 * — a smooth ~4× falloff between newcomer and entrenched. Entrenched
 * parties have a structural edge but their lead can be reversed by
 * cumulative campaign pressure (money + support + coattails) over the
 * cycle, matching real-world swing dynamics where even safe states can
 * flip in landslide years.
 */
export const PERSUASION_RESISTANCE_NO_REG = 0.0;
export const PERSUASION_RESISTANCE_FULL_REG = 0.5;
const PERSUASION_RESISTANCE_EXPONENT = 2;
export function persuasionResistance(reg: number | undefined): number {
  if (reg == null || !Number.isFinite(reg) || reg < 0) return PERSUASION_RESISTANCE_NO_REG;
  const clamped = Math.min(100, reg);
  const t = Math.pow(clamped / 100, PERSUASION_RESISTANCE_EXPONENT);
  return (
    PERSUASION_RESISTANCE_NO_REG +
    (PERSUASION_RESISTANCE_FULL_REG - PERSUASION_RESISTANCE_NO_REG) * t
  );
}

/**
 * Effective peelable fraction of a party's nominal vote — the single
 * multiplier the swing-flow engine applies to persuasion drivers:
 *
 *   eff_peel(reg) = transferableShare(reg) × (1 − persuasionResistance(reg))
 *
 *   eff_peel(undefined / no Reg data) = 0.20 × 1.00  = 0.200
 *   eff_peel(50)                      ≈ 0.165 × 0.875 ≈ 0.144
 *   eff_peel(100)                     = 0.10 × 0.50  = 0.050
 *
 * Exported so the driver-display layer can scale its "pp" rows by the SAME
 * fraction the engine uses (UI honesty: displayed driver magnitudes must not
 * overstate the real vote impact by the 5-20x pre-peel factor).
 */
export function effectivePeelableFraction(reg: number | undefined): number {
  return transferableShare(reg) * (1 - persuasionResistance(reg));
}
