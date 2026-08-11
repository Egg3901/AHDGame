import type { CountryId } from "@/lib/constants/countries";

/**
 * Political Strength reserve and pressure-ladder constants for Phase 3.
 *
 * See plan §"Phase 3 — Recommended default PS reserve / pressure model"
 * for the canonical model. Values sourced from user direction 2026-05-03;
 * tuning lands in the plan's Balance Appendix, not here.
 *
 * Phase 3 consumers:
 *  - `partyActionGeneration` reads passive trickle, treasury rates, cap formulas
 *  - `spendPoliticalStrength` reads pressure-ladder constants
 *  - `pressureDecay` turn-phase reads `PRESSURE_DECAY_PER_TURN`
 */

// ─── Passive PS gain ────────────────────────────────────────────────────────

/**
 * Per-turn flat passive PS, by scope (2026-06-25 rebalance). Applied by
 * `partyActionGeneration` every turn regardless of treasury — the baseline
 * reserve growth even an idle (or broke) party experiences. This replaced the
 * old uniform `1/turn` trickle plus the removed "% of treasury" phantom stream:
 * passive is now a meaningful, treasury-independent flat amount. Like every
 * stream it is still clamped at the hard cap (`NATIONAL_PS_CAP`).
 */
export const NATIONAL_PASSIVE_PS_PER_TURN = 20 as const;
export const STATE_PASSIVE_PS_PER_TURN = 5 as const;

// ─── Treasury-driven PS gain (country-normalized) ──────────────────────────

/**
 * Treasury cost per `+1 PS` of treasury-driven generation, by country.
 *
 * National rates from plan §"Recommended starting baselines for `+1 national PS`".
 * State / regional rates are 50% of national per Phase 0.5 §"Recommended" #2
 * (state cost is half of national → state generation is twice as efficient
 * per unit treasury).
 *
 * The structure normalizes country economic scale (JPY ¥5M ≈ USD $33k under
 * arbitrary parity, but treasury sizes scale to local currency in this game),
 * so the number-of-PS-per-hour-of-treasury-investment ends up roughly
 * comparable across countries.
 *
 * Inactive countries (BR / CN / IE / NG) get placeholder rates parallel to
 * their seed scale; the actual values aren't load-bearing until those
 * countries activate.
 */
export const TREASURY_PS_RATE_BY_COUNTRY: Record<CountryId, { national: number; state: number }> = {
  US: { national: 75_000, state: 37_500 },
  UK: { national: 60_000, state: 30_000 },
  DE: { national: 70_000, state: 35_000 },
  JP: { national: 5_000_000, state: 2_500_000 },
  IE: { national: 60_000, state: 30_000 },
  BR: { national: 350_000, state: 175_000 },
  CN: { national: 500_000, state: 250_000 },
  NG: { national: 30_000_000, state: 15_000_000 },
  HU: { national: 50_000, state: 25_000 },
  PL: { national: 50_000, state: 25_000 },
  RO: { national: 50_000, state: 25_000 },
  YU: { national: 50_000, state: 25_000 },
  BG: { national: 50_000, state: 25_000 },
  UKR: { national: 50_000, state: 25_000 },
  BLR: { national: 50_000, state: 25_000 },
  CS: { national: 50_000, state: 25_000 },
  BAL: { national: 50_000, state: 25_000 },
  RU: { national: 500_000, state: 250_000 },
  FR: { national: 70_000, state: 35_000 },
  IT: { national: 70_000, state: 35_000 },
  ES: { national: 70_000, state: 35_000 },
  SE: { national: 60_000, state: 30_000 },
  TR: { national: 70_000, state: 35_000 },
  GR: { national: 70_000, state: 35_000 },
  AT: { national: 70_000, state: 35_000 },
  FI: { national: 60_000, state: 30_000 },
  DD: { national: 90_000, state: 45_000 },
  SCO: { national: 60_000, state: 30_000 }, // mirrors UK (sterling zone)
  WAL: { national: 60_000, state: 30_000 }, // mirrors UK (sterling zone)
} as const;

// ─── Soft-cap slowdown bands ────────────────────────────────────────────────

/**
 * Soft-cap slowdown multiplier applied to **treasury-driven** gain only.
 * Disabled 2026-06-28: flat 1.0 multiplier at all levels so treasury-driven
 * PS gain is never throttled before the hard cap.
 */
export const SOFT_CAP_BANDS = [{ upTo: 1.0, mult: 1.0 }] as const;

/**
 * Effective treasury multiplier given current PS as a fraction of cap.
 * Returns `0` when at or above cap; otherwise always 1.0 (soft cap disabled).
 */
export function softCapMultiplier(currentPctOfCap: number): number {
  if (currentPctOfCap >= 1) return 0;
  return 1.0;
}

// ─── Pressure ladder ────────────────────────────────────────────────────────

/**
 * Per-geography pressure decay applied each turn (subtracted from each
 * `partyStrengthPressure.value`, floored at `0`).
 *
 * Locked at `3` per turn so a party can still burst during heated elections
 * but accumulated pressure dissipates within a few turns of inactivity in
 * that geography.
 */
export const PRESSURE_DECAY_PER_TURN = 3 as const;

/**
 * Per-spend pressure increment in the same geography. Effective PS cost of
 * the next spend in that geography rises by this amount until the ladder
 * caps at `PRESSURE_LADDER_MAX_COST`.
 */
export const PRESSURE_LADDER_INCREMENT = 1 as const;

/**
 * Hard ceiling on the per-action effective PS cost from pressure ladder
 * escalation. Once an action's `(baseCost + pressure)` would exceed this,
 * the cost saturates here rather than growing indefinitely.
 *
 * Note: this caps the **delta** added by pressure, not the action's base
 * cost. A 6-cost base action with full pressure caps at `8`, not `14`.
 */
export const PRESSURE_LADDER_MAX_COST = 8 as const;

/**
 * Hard ceiling on the STORED per-(party, geography) pressure value.
 *
 * The cost ladder saturates at `PRESSURE_LADDER_MAX_COST` once
 * `baseCost + pressure` reaches it, so pressure stored beyond the point that
 * already maxes the cheapest action (base cost `1` → pressure `7`) has ZERO
 * further effect on cost. Left unbounded, however, `$inc`-per-spend let the
 * stored value run away (observed 219 in one geography). Because decay is only
 * `PRESSURE_DECAY_PER_TURN` (3) per turn, such a value stays pinned at max cost
 * for ~70 turns after the party stops spending — a heavy builder's cost never
 * visibly recovers (ticket #945: "Florida PS cost is always 8, for days").
 *
 * Capping the stored value at `PRESSURE_LADDER_MAX_COST` (8) keeps the ladder
 * fully punishing while active (still enough to saturate every action's cost)
 * but lets it decay back to `0` within a few turns of inactivity, as the decay
 * model intends.
 */
export const PRESSURE_LADDER_MAX_VALUE = PRESSURE_LADDER_MAX_COST;

/**
 * Effective PS cost given a base action cost and current pressure value.
 * Saturates at `PRESSURE_LADDER_MAX_COST`.
 */
export function effectivePsCost(baseCost: number, pressure: number): number {
  const total = baseCost + Math.max(0, pressure);
  return Math.min(total, PRESSURE_LADDER_MAX_COST);
}

// ─── Cap formulas ───────────────────────────────────────────────────────────

/**
 * Flat national PS cap — the full cap a **Major** party may accumulate, identical
 * in every country (2026-06-25). Replaces the former region-scaled formula
 * (`max(100, round(80 + 4 * regionCount))`) which gave smaller countries tiny
 * caps (UK 128, JP 112) so close to the Minor base cap (100) that the
 * Major/Minor tier gap was meaningless. A uniform cap restores a real gap: a
 * Minor party still climbs from `MINOR_PARTY_BASE_PS_CAP` (100) via earned
 * regions, while graduating to Major unlocks the full `NATIONAL_PS_CAP`.
 *
 * Note: `REGION_COUNT_BY_COUNTRY` is retained — it still drives the tier
 * graduation/demotion thresholds (`⌈regions/3⌉`), which are unaffected by this
 * cap change.
 */
export const NATIONAL_PS_CAP = 280 as const;

/**
 * State / regional PS cap default. Per-row override exists on
 * `Party.politicalStrengthCap` but state-party rows currently use this
 * constant directly (no per-state override field — keeps the schema
 * minimal until a use case appears).
 */
export const STATE_PS_CAP_DEFAULT = 30 as const;

/**
 * Fraction of the normal state cap that a state/region party with only NPP
 * members (or no members) may accumulate. A single homed Player Character
 * member lifts the cap back to the full `STATE_PS_CAP_DEFAULT`.
 *
 * Rationale: NPP-only state parties were hoarding PS to the full cap, which
 * pinned the Build Org PS-leverage factor (`ownPS / avgRivalPS`) near its 0.5×
 * floor for player parties facing them. Capping NPP-only reserves at 25% keeps
 * rival reserves modest so player leverage stays meaningful.
 */
export const NPP_ONLY_STATE_PS_CAP_FRACTION = 0.25;

/**
 * Effective PS cap for a state/region party given whether it has at least one
 * homed Player Character member. With a player member: full `STATE_PS_CAP_DEFAULT`
 * (30). Otherwise (NPP-only or empty): 25% of it (7.5).
 */
export function effectiveStatePsCap(hasPlayerMember: boolean): number {
  return hasPlayerMember
    ? STATE_PS_CAP_DEFAULT
    : STATE_PS_CAP_DEFAULT * NPP_ONLY_STATE_PS_CAP_FRACTION;
}

/**
 * Region count by country, as used by the cap formula. Hardcoded here
 * because the plan locks Japan to 8 regions (not the 47 prefectures the
 * map data carries) — relying on the seed file row count would silently
 * drift if the map were re-cut later.
 *
 * **MUST match the actual seeded region count** for `regionCount`-derived
 * thresholds (party tier graduation, demotion) to be reachable. IE and CN
 * previously used the real-world county / province count (26 / 33), which
 * made the graduation threshold (`⌈regions/3⌉`) larger than the actual
 * number of seeded regions — graduation was mathematically impossible.
 * Aligned both to the seed in 2026-06-20 (IE 26 → 8, CN 33 → 7) so a party
 * with strong cross-region Org can graduate to Major; the CN case had been
 * masked by `regimeStatus: "ruling"` pinning CCP Major regardless.
 */
export const REGION_COUNT_BY_COUNTRY: Record<CountryId, number> = {
  US: 50,
  UK: 12,
  DE: 16,
  JP: 8,
  IE: 8, // 8 authored planning regions (not the 26 IRL counties)
  BR: 27,
  CN: 7, // 7 authored macro-regions (not the 33 IRL provinces)
  NG: 36,
  HU: 6, // 6 seeded macro-regions (Cold-War split)
  PL: 8,
  RO: 7,
  YU: 8,
  BG: 5,
  // Union republics, now seeded with real oblast/republic region sets rather
  // than the single placeholder region the dormant stubs carried.
  UKR: 6,
  BLR: 6,
  CS: 4,
  BAL: 3,
  RU: 17, // 17 seeded USSR macro-regions
  FR: 8,
  IT: 8,
  ES: 8,
  SE: 8,
  TR: 8,
  GR: 6,
  AT: 5,
  FI: 6,
  DD: 6, // 6 seeded regions (5 Länder + East Berlin)
  SCO: 7, // 7 authored sub-regions (seeded at secession)
  WAL: 6, // 6 authored sub-regions (seeded at secession)
} as const;

/**
 * Resolve the full national (Major) PS cap for a country. Now a flat
 * `NATIONAL_PS_CAP` for every country; the `countryId` parameter is retained so
 * call sites stay stable and a per-country cap could be reintroduced here in one
 * place if ever needed.
 */
export function nationalCapForCountry(_countryId: CountryId): number {
  return NATIONAL_PS_CAP;
}

// ─── Priority Region ────────────────────────────────────────────────────────

/**
 * Number of turns for the Priority Region cooldown. `168` turns = 7 IRL days
 * at the standard hourly cadence; matches the plan's locked assumption.
 */
export const PRIORITY_REGION_LOCKOUT_TURNS = 168 as const;

/**
 * Maximum number of states / regions in a Priority Region cluster.
 * Per the plan: "2-3 adjacent states / regions".
 */
export const PRIORITY_REGION_MAX_STATES = 3 as const;

/**
 * Effectiveness bonus on direct national PS actions in a Priority Region
 * state. Multiplier on the action's primary effect (Org gain, Reg gain,
 * Support gain, etc.) — NOT on the PS cost.
 */
export const PRIORITY_REGION_EFFECT_BONUS = 0.25 as const;

/**
 * Extra states a party may include in its Priority Region cluster when
 * it holds the state-level executive (US governor / DE Land Minister-
 * President / JP prefectural governor / UK devolved First Minister) in
 * at least one of the cluster's states. Evaluated at SET time only —
 * losing the anchor mid-lockout doesn't shrink the cluster. See the
 * 2026-05-23 priority-region wiring spec (item #13 of the things-left
 * walkthrough).
 */
export const PRIORITY_REGION_GOVERNOR_ANCHOR_BONUS = 1 as const;

// ─── Explicit PS treasury investment (chair-set per-party budget) ───────────

/**
 * Legacy premium multiplier that produced the per-country explicit-spend rate
 * from the per-country base rate (`TREASURY_PS_RATE_BY_COUNTRY`). Historical
 * anchor: US national `$75,000` base × `250/75 ≈ 3.333` = `$250,000 / +1 PS`.
 * Retained purely as part of the rate derivation; the removed phantom stream it
 * was once a "premium over" no longer exists.
 */
export const PS_INVESTMENT_PREMIUM_VS_PHANTOM = 250_000 / 75_000;

/**
 * Spend-rate discount (2026-06-25 rebalance). The explicit `+1 PS` cost is `5%`
 * of the legacy per-country rate — UK national `£200,000 → £10,000`, US
 * `£250,000 → £12,500`, etc. Applied uniformly so each country keeps its own
 * (different) base rate, just 20× cheaper. Makes the spend lever materially
 * useful instead of a token nudge.
 */
export const PS_INVESTMENT_RATE_FRACTION = 0.05 as const;

/**
 * Maximum PS/turn from the explicit investment budget. Raised `4 → 20`
 * (2026-06-25): combined with the cheaper rate, a party draining its whole
 * treasury at the new `5%` rate buys up to 20 PS/turn (the flat passive stacks
 * on top of this).
 */
export const PS_INVESTMENT_MAX_TIERS = 20 as const;

/**
 * Effective treasury cost per `+1 PS` for the explicit investment field,
 * country-scaled. Used by `partyActionGeneration` and the `/ps-investment`
 * routes when validating the chair-set budget.
 *
 * Equals `5%` of the legacy per-country rate (2026-06-25 rebalance). Examples
 * (national): US `£12,500`, UK `£10,000`, DE `≈€11,667`, JP `≈¥833,333`.
 * State rate is half (matching the convention in `TREASURY_PS_RATE_BY_COUNTRY`).
 */
export function psInvestmentRate(countryId: CountryId, scope: "national" | "state"): number {
  // Treasury (post-cf-inconsistency-fix Phase 6) is persisted in the party's
  // native local currency, matching `TREASURY_PS_RATE_BY_COUNTRY`'s documented
  // units (£75k USD, £60k GBP, ¥5M JPY, etc.). The rate stays in native local,
  // so the math layer compares apples to apples without conversion.
  const base =
    TREASURY_PS_RATE_BY_COUNTRY[countryId]?.[scope] ?? TREASURY_PS_RATE_BY_COUNTRY.US[scope];
  return base * PS_INVESTMENT_PREMIUM_VS_PHANTOM * PS_INVESTMENT_RATE_FRACTION;
}

// ─── Build Org action ───────────────────────────────────────────────────────

/**
 * Base PS cost for one Build Org action (grow your own party's Org in a
 * specific state, drawing from the unaffiliated/independent pool).
 * Pressure ladder applies on top — repeated state-actions of any kind
 * (Build / Contest / etc.) escalate cost since the ladder is per-(party,
 * state), not per-action.
 */
export const BUILD_ORG_BASE_PS_COST = 1 as const;

/**
 * Base Org% gain at ideal conditions (full headroom, fresh own Org, full
 * PS reserve relative to rivals, behind in this state). The actual gain
 * scales by the four factors in `calcUnifiedBuildOrg`.
 */
export const BUILD_ORG_BASE_GAIN = 2.0 as const;

/**
 * Marketing-style diminishing-returns pivot for own Org, applied to Org ABOVE
 * `BUILD_ORG_DIMINISHING_THRESHOLD` (see below). Let `e = max(0, ownOrg − 50)`;
 * then `pivot / (pivot + e)` shrinks — at `e = pivot` (ownOrg = 75) the
 * multiplier is 0.5; at `e = 3× pivot` (ownOrg = 125) it is 0.25. Below the
 * threshold there is no penalty (multiplier = 1.0).
 */
export const BUILD_ORG_DIMINISHING_PIVOT = 25 as const;

/**
 * Own-Org threshold below which Build Org / Contest take NO diminishing-returns
 * penalty (`ownDiminishing = 1.0`). Above it, the marketing-style pivot curve
 * resumes, measured from this threshold: at `threshold + pivot` Org the
 * multiplier is 0.5. Keeps early growth ungrindy while still slowing dominance.
 */
export const BUILD_ORG_DIMINISHING_THRESHOLD = 50;

/**
 * PS-leverage clamp range. Effective leverage = clamp(floor, ceiling,
 * ownPS / avgRivalPSInState). A small party with a hoarded reserve maxes
 * at `ceiling`× the base gain; a party that's burned through its PS while
 * rivals stockpile bottoms at `floor`× the base.
 */
export const BUILD_ORG_PS_LEVERAGE_FLOOR = 0.5 as const;
export const BUILD_ORG_PS_LEVERAGE_CEILING = 1.5 as const;

/**
 * Catch-up addend when at least one rival party in this state has higher Org%
 * than you. Added to `rawLeverage` (not multiplied) so a trailing party at the
 * PS floor (0.5) reaches 1.0 effective leverage instead of the old broken
 * `0.5 × 1.5 = 0.75` that punished the underdog. Applied once — "are you
 * behind" not "by how much".
 */
export const BUILD_ORG_CATCHUP_BONUS = 0.5 as const;

/**
 * Hard ceiling on `effectiveLeverage = rawLeverage + catchupAddend`. With
 * `rawLeverage` capped at `BUILD_ORG_PS_LEVERAGE_CEILING` (1.5) and
 * `catchupAddend` at most `BUILD_ORG_CATCHUP_BONUS` (0.5), the combined
 * max is 2.0 — tighter than the old multiplicative ceiling of 1.5×1.5 = 2.25.
 */
export const BUILD_ORG_PS_EFFECTIVE_CEILING =
  BUILD_ORG_PS_LEVERAGE_CEILING + BUILD_ORG_CATCHUP_BONUS; // 2.0

/**
 * How efficiently a Build Org click converts a rival's exposed (poachable) Org
 * into headroom, relative to drawing from the open Unaffiliated pool. The
 * per-rival poachable Org is scaled by this weight before it competes with the
 * pool for the click's gain. This is the single balance knob for the unified
 * Build Org model (2026-06-24 spec).
 *
 * Raised `0.5 → 1.5` (2026-06-25) to buff Build Org in saturated states. The
 * gain in a poach-dominated state (small Unaffiliated pool) scales linearly with
 * this weight — tripling it ~3×'s the build there, where progress was painfully
 * slow (e.g. +0.06 Org/click). Open states are unaffected in TOTAL: the throttle
 * is `max(poolWeight, rivalWeight)`, so while the pool dominates the gain is
 * bounded by the pool weight regardless — the buff only reapportions that gain
 * toward poaching and takes over once a state saturates.
 */
export const RIVAL_POACH_HEADROOM_WEIGHT = 1.5 as const;

/**
 * Fraction of a party's NATIONAL PS pool that counts toward its effective
 * strength in a single-state Build Org comparison (the `psLeverage` factor and
 * the per-rival poach weighting). State PS is the primary term; national backing
 * adds a secondary boost so a nationally-strong party poaches a little harder
 * and defends a little better everywhere — without national fully eclipsing the
 * per-state contest.
 *
 * Reduced 0.1 → 0.05 (2026-06-28, ticket #0762). At 0.1 a 4.4× national PS
 * gap (e.g. 252 vs 57) added +25.3 vs +5.7 to blended PS, pinning psLeverage
 * at its extremes (floor/ceiling) across all states and cancelling the catchup
 * bonus. At 0.05 the blended contribution is halved (+12.6 vs +2.85), leaving
 * room for ps-ratio to fall between the clamp extremes in normal play.
 */
export const NATIONAL_PS_BLEND_FRACTION = 0.05 as const;

/**
 * Effective PS for a party in a single-state Build Org comparison:
 * `statePs + NATIONAL_PS_BLEND_FRACTION × nationalPs`. Applied identically to
 * the spender and every rival so the leverage + poach math compares like with
 * like. Negative inputs are floored at 0.
 */
export function blendedComparisonPs(statePs: number, nationalPs: number): number {
  return Math.max(0, statePs) + NATIONAL_PS_BLEND_FRACTION * Math.max(0, nationalPs);
}

/**
 * Fraction of the national PS cost for a national-targeted Build Org action
 * that is immediately refunded back to the national party's PS pool (2026-06-28,
 * ticket #0762). Rewards active national org-building for treasury-poor parties:
 * the effective net cost per national-scope Build Org click is 0.8 PS instead of
 * 1, and the recovery slowly rebuilds the pool for further activity.
 */
export const NATIONAL_PS_ACTIVITY_RECOVERY_FRACTION = 0.2 as const;

// ─── Rival poach (unified Build Org) ────────────────────────────────────────

/**
 * Low-Org taper for the rival-poach slice of unified Build Org. Each rival's
 * poachable Org is scaled by `clamp(0, 1, rivalOrg / CONTEST_LOW_ORG_TAPER)`, so
 * poaching a party already near 0 Org tapers off rather than cheaply zeroing it
 * out. At or above this Org the rival exposes its full share; at half this Org it
 * exposes half, etc. (Carried over from the retired Contest action.)
 */
export const CONTEST_LOW_ORG_TAPER = 10 as const;

/**
 * Org-vs-PS blend weight for the per-rival poach exposure (2026-06-25). A rival's
 * exposed fraction of its Org is `W·orgIntensity + (1 − W)·psAdvantage`, where
 * `orgIntensity = rivalOrg / leadRivalOrg` (the strongest rival = 1) and
 * `psAdvantage = clamp(0, 1, (ownPS − rivalPS) / ownPS)`.
 *
 * The old model multiplied Org by `psAdvantage` alone, which hard-zeroed any
 * rival whose PS matched or exceeded the spender's — and since the dominant Org
 * party usually also hoards the most PS, the top party was effectively immune
 * while the weakest (lowest-PS) party bled the most. Blending in Org *size*
 * makes the leading party a primary target by virtue of its share even at PS
 * parity, while PS still rewards out-muscling lower-PS rivals.
 *
 * `W = 0.5` is the single tunable knob: raise toward Org to make size dominate,
 * lower toward PS to restore the strength-gap flavor. Bounded `[0, 1]` so the
 * exposure stays in `[0, 1]` and Org conservation/clamps are unaffected.
 */
export const POACH_ORG_SHARE_WEIGHT = 0.5 as const;
