/**
 * `persuasion_drivers(P_j vs P_i)` — captures every cross-party signal
 * that moves voters from P_i toward P_j in a general election.
 *
 * Per §7.3.2 of `docs/design/political-system-reg-support.md`, this
 * returns a signed contribution in `[-1, +1]`:
 *   - positive: P_j is more persuasive to P_i's marginal voters than P_i is to itself
 *   - negative: P_i defends successfully (no swing in this direction)
 *
 * Components contributing (each clamped to a slice of the budget):
 *   - **Candidate Support delta** — how much momentum advantage does
 *     P_j's candidate have over P_i's? (Mood lift on the swing line,
 *     not on the nominal_share line.)
 *   - **Policy distance** — how close is P_j's ideology to the state's
 *     median voter relative to P_i? Centrism proxy on the candidates'
 *     own positions until per-state median-voter data lands.
 *   - **Money / spend** — log-ratio of campaign funds. 10× advantage
 *     saturates the slice (diminishing-returns curve).
 *   - **Incumbency** — for legislatures, a small positive shield scaled by
 *     prior seat-share. For single-winner executive own-races it scales with
 *     the sitting executive's approval: a shield when popular, a drag when
 *     unpopular (see `approvalAdjustedIncumbencyBudget`).
 *
 * The returned value is the sum of components clamped to `[-1, +1]`.
 */

import type { EnrichedCandidate, DistributeVotesOptions } from "./types";

/**
 * Largest contribution any single driver component can make to the
 * aggregate. Per-driver budgets sum to ≤ 1.0 so all-five-firing in one
 * direction lands near the aggregate clamp without artificial cap
 * pressure.
 *
 * T1 tuning re-pass (`2026-05-22-driver-tuning-repass.md`) replaced
 * the previously-shared 0.4 component budget with these per-driver
 * budgets, calibrated against political-science benchmarks:
 *
 *   - Support delta (0.30): integrates rallies + scandals +
 *     endorsements; should be the most expressive single driver.
 *   - Policy distance (0.15): previously dominated saturation at 0.40 —
 *     cut significantly; the per-state median voter (M-phase) makes
 *     the remaining magnitude more honest.
 *   - Money (0.20): diminishing returns; capped per log-ratio shape.
 *   - Incumbency (0.10): smallest; matches research on incumbent edge.
 *
 * Sum: 0.75 — leaves the aggregate `[-1, +1]` clamp as a safety rail
 * that activates only on driver pile-on, not by structural design.
 * (Presidential coattails are no longer a persuasion driver — they apply
 * as a nominal-share multiplier; see `presidentialCoattail.ts`.)
 * Invariant guarded by a unit test in voteDistributionSwingFlow.test.ts.
 */
export const SUPPORT_DELTA_BUDGET = 0.3 as const;
export const POLICY_DISTANCE_BUDGET = 0.15 as const;
export const MONEY_BUDGET = 0.2 as const;
export const INCUMBENCY_BUDGET = 0.1 as const;

/**
 * Approval pivot for the executive incumbency curve — set to `BASE_APPROVAL`
 * so a race with no resolved approval lands exactly on the neutral
 * seat-share fallback. Above the pivot the incumbent earns a shield (cap
 * `INCUMBENCY_SHIELD_MAX` reached `INCUMBENCY_SHIELD_MAX / INCUMBENCY_APPROVAL_SLOPE`
 * points above pivot); below it suffers a drag (cap `INCUMBENCY_DRAG_MAX`).
 * Slope is 1pp of budget per approval point (budget units ×100 = pp shown).
 * See 2026-06-22-incumbency-approval-bonus-design.md.
 */
// Pivot: approval an incumbent must clear to earn a shield (below it, a drag).
// Held below the live national mean so most incumbents still get a smaller
// shield and only the weakest (~44-46) tip into mild drag.
export const INCUMBENCY_APPROVAL_PIVOT = 46 as const;
export const INCUMBENCY_SHIELD_MAX = 0.1 as const;
// Symmetric with the shield: incumbency should not penalize an unpopular
// incumbent harder than it rewards a popular one (was 0.15). (#2899)
export const INCUMBENCY_DRAG_MAX = 0.1 as const;
export const INCUMBENCY_APPROVAL_SLOPE = 0.01 as const;

/**
 * Single-seat legislative (US Senate) incumbency: a flat, officeholder-based
 * shield that decays with the sitting senator's consecutive terms to a
 * permanent floor. Deliberately excludes favorability/approval (already priced
 * into the election math elsewhere) and never becomes a drag. See
 * 2026-07-15-senate-incumbency-driver-design.md.
 */
export const LEGISLATIVE_INCUMBENCY_SHIELD = 0.06 as const; // flat +6 pts
export const LEGISLATIVE_TENURE_FATIGUE_PER_TERM = 0.01 as const; // −1 pt / term beyond first
export const LEGISLATIVE_INCUMBENCY_MIN = 0.01 as const; // permanent +1 pt floor

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Signed incumbency budget as a function of the sitting executive's approval.
 * Returns `INCUMBENCY_BUDGET` (the flat fallback) when approval is missing /
 * NaN, so callers that don't supply approval are unaffected.
 */
export function approvalAdjustedIncumbencyBudget(approval: number | undefined): number {
  if (approval == null || !Number.isFinite(approval)) return INCUMBENCY_BUDGET;
  const a = clamp(approval, 0, 100);
  if (a >= INCUMBENCY_APPROVAL_PIVOT) {
    return Math.min(
      INCUMBENCY_SHIELD_MAX,
      (a - INCUMBENCY_APPROVAL_PIVOT) * INCUMBENCY_APPROVAL_SLOPE
    );
  }
  return -Math.min(
    INCUMBENCY_DRAG_MAX,
    (INCUMBENCY_APPROVAL_PIVOT - a) * INCUMBENCY_APPROVAL_SLOPE
  );
}

/**
 * Pick the best representative candidate for a given party in the enriched
 * list. For FPTP families this is the only candidate; for proportional /
 * multi-seat families, prefer the highest-Support candidate as the
 * party's "face" for the persuasion-driver calculation. Defensive: returns
 * undefined when no candidate is found (caller treats as neutral).
 */
function representative(
  partyId: string,
  enriched: EnrichedCandidate[]
): EnrichedCandidate | undefined {
  let best: EnrichedCandidate | undefined;
  let bestSupport = -Infinity;
  for (const ec of enriched) {
    if (ec.party !== partyId) continue;
    const support = typeof ec.support === "number" ? ec.support : 0;
    if (support > bestSupport) {
      bestSupport = support;
      best = ec;
    }
  }
  return best;
}

/**
 * Candidate-Support delta driver. When P_j's representative candidate
 * has materially higher Support than P_i's, voters at the margin shift
 * toward P_j. Scaled by `SUPPORT_DELTA_BUDGET` so a 100-point Support
 * gap never single-handedly maxes the aggregate driver.
 *
 * Returns 0 when either party has no representative (no candidate filed).
 */
function supportDeltaDriver(pj: string, pi: string, enriched: EnrichedCandidate[]): number {
  const candJ = representative(pj, enriched);
  const candI = representative(pi, enriched);
  if (!candJ || !candI) return 0;
  const supportJ = typeof candJ.support === "number" ? candJ.support : 50;
  const supportI = typeof candI.support === "number" ? candI.support : 50;
  // Delta range [-100, +100] → scale to [-1, +1] → clamp to component budget.
  const delta = (supportJ - supportI) / 100;
  return clamp(delta, -1, 1) * SUPPORT_DELTA_BUDGET;
}

/**
 * Policy-distance driver. P_j's representative candidate's position vs
 * P_i's representative candidate's position, relative to the state's
 * median voter. When P_j sits closer to the median than P_i, that's a
 * positive driver — easier to peel marginal voters.
 *
 * When no `medianVoter` is supplied (older callers, primary phase, etc.)
 * the driver falls back to distance-from-`(0, 0)`, preserving the
 * original behavior. With a median supplied, distance is measured
 * relative to the state-specific voter mood — see
 * `2026-05-22-per-state-median-voter.md`.
 *
 * Normalization denominator adapts to the median's distance from origin
 * so off-center states preserve the [-1, +1] bound (the max possible
 * distance on the ±4 grid stretches when the median shifts).
 */
function policyDistanceDriver(
  pj: string,
  pi: string,
  enriched: EnrichedCandidate[],
  options: DistributeVotesOptions | undefined
): number {
  const candJ = representative(pj, enriched);
  const candI = representative(pi, enriched);
  if (!candJ || !candI) return 0;

  const medianEP = options?.medianVoter?.ep ?? 0;
  const medianSP = options?.medianVoter?.sp ?? 0;

  // Distance from the median voter. Smaller distance = closer to local
  // voter mood = wider appeal to marginal voters.
  const distJ = Math.hypot(candJ.charEP - medianEP, candJ.charSP - medianSP);
  const distI = Math.hypot(candI.charEP - medianEP, candI.charSP - medianSP);
  // Max possible distance on ±4 grid relative to median expands as the
  // median shifts off origin. Compute dynamically to keep delta in
  // [-1, +1] under all median positions.
  const maxDist = Math.hypot(4 + Math.abs(medianEP), 4 + Math.abs(medianSP));
  const normJ = maxDist > 0 ? distJ / maxDist : 0;
  const normI = maxDist > 0 ? distI / maxDist : 0;
  // Positive when J is more centrist (closer to median) than I.
  const delta = clamp(normI - normJ, -1, 1);
  return delta * POLICY_DISTANCE_BUDGET;
}

/**
 * Money / spend driver. When P_j's campaign funds materially exceed
 * P_i's in this race, persuasion spend tips marginal voters toward P_j.
 * Diminishing returns: a 10× funds advantage is not 10× as persuasive,
 * so we use a log ratio rather than a linear delta.
 *
 * Returns 0 when `fundsByParty` is undefined / empty or when either
 * party has no funds recorded.
 */
function moneyDriver(pj: string, pi: string, options: DistributeVotesOptions | undefined): number {
  const fundsMap = options?.fundsByParty;
  if (!fundsMap || fundsMap.size === 0) return 0;
  const fundsJ = fundsMap.get(pj) ?? 0;
  const fundsI = fundsMap.get(pi) ?? 0;
  if (fundsJ <= 0 && fundsI <= 0) return 0;
  // log10 ratio with a +1 floor to avoid division-by-zero and inf.
  // log10(2) ≈ 0.30 (2× funds), log10(10) = 1.0 (10× funds — saturates).
  // Use a 1-unit ratio cap so the budget caps at 10× advantage.
  const ratio = Math.log10((fundsJ + 1) / (fundsI + 1));
  return clamp(ratio, -1, 1) * MONEY_BUDGET;
}

/**
 * Incumbency driver. For single-winner executive own-races (approval
 * supplied) it is a full-magnitude directional shield/drag scaled by the
 * sitting executive's approval; otherwise defenders with larger prior
 * seat-share defend more. Per the share-weighted (option δ) model in
 * `2026-05-22-swing-flow-driver-activation.md` §A1 and the approval overlay
 * in `2026-06-22-incumbency-approval-bonus-design.md`.
 *
 * US Senate single-seat races use the dedicated `legislativeIncumbentPartyId`
 * flat-shield branch above and never reach the seat-share fallback. For
 * proportional / multi-seat races (US House, UK Regional Council, JP
 * Shugiin/Sangiin, DE Bundestag, etc) the map carries each party's last-cycle
 * seat-share so the lift / drag scales with how much each party is defending.
 *
 * Returns 0 when no map is supplied (first-ever race, open seat with no
 * prior cycle, or missing data — driver degrades gracefully).
 */
function incumbencyDriver(
  pj: string,
  pi: string,
  options: DistributeVotesOptions | undefined
): number {
  // Single-winner executive own-race: full-magnitude directional shield/drag
  // scaled by the sitting executive's approval. The incumbent party gets the
  // signed budget; its challengers get the negation; bystander pairs neutral.
  const incumbentPartyId = options?.incumbentPartyId;
  if (incumbentPartyId != null) {
    // Approval shield/drag (capped), then subtract the party-tenure voter-fatigue
    // drag post-cap so a long-tenured party feels "time for a change" even when
    // popular. Folded into this driver — the incumbent gets the net, its
    // challengers the negation, so a net-negative (fatigue > shield) actively
    // helps challengers.
    const budget = approvalAdjustedIncumbencyBudget(options?.incumbentApproval);
    const net = budget - (options?.incumbentTenurePenalty ?? 0);
    if (pj === incumbentPartyId) return net;
    if (pi === incumbentPartyId) return -net;
    return 0;
  }

  // Single-seat legislative own-race (US Senate): a flat directional shield for
  // the sitting officeholder, decaying with tenure to a +1pt floor. Set only
  // when the incumbent is actually running; open seats leave it unset → the
  // seat-share fallback / 0 applies. Takes precedence over the seat-share map.
  const legislativeIncumbentPartyId = options?.legislativeIncumbentPartyId;
  if (legislativeIncumbentPartyId != null) {
    const terms = options?.legislativeIncumbentTenureTerms ?? 1;
    const net = Math.max(
      LEGISLATIVE_INCUMBENCY_MIN,
      LEGISLATIVE_INCUMBENCY_SHIELD - LEGISLATIVE_TENURE_FATIGUE_PER_TERM * Math.max(0, terms - 1)
    );
    if (pj === legislativeIncumbentPartyId) return net;
    if (pi === legislativeIncumbentPartyId) return -net;
    return 0;
  }

  // Fallback (legislatures, primaries, missing data): prior-cycle seat-share
  // weighted, ±INCUMBENCY_BUDGET at full single-seat margin.
  const shareMap = options?.incumbentSeatShareByParty;
  if (!shareMap) return 0;
  const shareJ = shareMap.get(pj) ?? 0;
  const shareI = shareMap.get(pi) ?? 0;
  return (shareJ - shareI) * INCUMBENCY_BUDGET;
}

/**
 * Aggregated `persuasion_drivers(P_j vs P_i)`. Returns a signed
 * contribution in `[-1, +1]`.
 *
 * Components contributing to the bounded sum:
 *   - candidate Support delta
 *   - policy-distance proxy
 *   - money: log-ratio of campaign funds
 *   - incumbency: seat-share shield for legislatures; approval-scaled
 *     shield/drag for single-winner executive own-races
 *
 * Each component contributes within its own per-driver budget so no
 * single signal dominates. Per-driver budgets sum to 0.75 so the
 * aggregate `[-1, +1]` clamp activates only on pile-on. The final
 * clamped sum drives the peeling magnitude in the swing-flow model.
 */
export function persuasionDrivers(
  pj: string,
  pi: string,
  enriched: EnrichedCandidate[],
  options?: DistributeVotesOptions
): number {
  const support = supportDeltaDriver(pj, pi, enriched);
  const policy = policyDistanceDriver(pj, pi, enriched, options);
  const money = moneyDriver(pj, pi, options);
  const incumbency = incumbencyDriver(pj, pi, options);
  return clamp(support + policy + money + incumbency, -1, 1);
}

/**
 * Labeled per-component breakdown of `persuasion_drivers(P_j vs P_i)`.
 * Pure presentational output — engine consumes the scalar aggregate via
 * `persuasionDrivers()`, the UI consumes this typed list to render named
 * bars in `PersuasionDrivers.tsx`.
 *
 * Each entry is the signed component contribution scaled to percentage
 * points (i.e. * 100), since the UI labels its axis "+/- pts" by
 * convention. Components contributing exactly 0 are still returned so
 * the UI can render a deliberate 0 instead of omitting (e.g. Money when
 * no spend data is plumbed).
 */
export interface PersuasionDriverComponent {
  /** Display label. Matches the `PersuasionDriver.label` type used by UI. */
  label: string;
  /** Signed contribution in percentage points, scaled from internal [-1, +1]. */
  contributionPct: number;
}

export function getPersuasionDriverBreakdown(
  pj: string,
  pi: string,
  enriched: EnrichedCandidate[],
  options?: DistributeVotesOptions
): PersuasionDriverComponent[] {
  // Scale internal [-1, +1] component values to percentage points so the
  // UI's signed-bar rendering reads naturally. Multiplied by 100, each
  // row falls in [-budget x 100, +budget x 100]: incumbency approval
  // shield/drag is +/-10 pp (tenure fatigue can push the net lower);
  // Support delta is +/-30 pp.
  const scale = 100;
  return [
    { label: "Candidate Support", contributionPct: supportDeltaDriver(pj, pi, enriched) * scale },
    {
      label: "Policy alignment",
      contributionPct: policyDistanceDriver(pj, pi, enriched, options) * scale,
    },
    { label: "Money", contributionPct: moneyDriver(pj, pi, options) * scale },
    { label: "Incumbency", contributionPct: incumbencyDriver(pj, pi, options) * scale },
  ];
}
