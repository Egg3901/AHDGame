/**
 * Pacing constants for passive Org/Reg drift and decay processors.
 *
 * See [docs/design/political-system-reg-support.md §8.1](../../../../docs/design/political-system-reg-support.md)
 * for the full design and §8.2 for why these rates (drift 10× decay; both
 * very small per turn so movement is a slow background pressure).
 *
 * Phase 3 (regDriftDecay processor) consumes these. Phase 5 (general
 * election formulas) reads them for documentation context.
 *
 * Sourced from user direction 2026-05-03; tuning lands in the plan's
 * Balance Appendix, not here.
 */

import type { CountryId } from "@/lib/constants/countries";

/**
 * Passive Reg% drift per turn toward each party's `(Org% − country lag)`
 * baseline (see `REG_LAG_BELOW_ORG_PCT_BY_COUNTRY`). One-directional (up
 * only) — Reg only drifts UP when the target is above current Reg. Seeded
 * registration is durable and should move on real political causes, not
 * decay toward Org on a clock. Downward movement comes from the decay
 * mechanism (PASSIVE_REG_DECAY_RATE) and active political events.
 *
 * Bounds: percent points per hourly turn.
 *
 * 2026-06-21: bumped 0.04 → 0.06 after reverting the active Registration
 * Drive action. Auto-build is the only Reg-growth lever again, so a moderate
 * pace bump (~50%) compensates for the lost active path. ~1.44 pp/day toward
 * Org target; a committed party covers a 50-pt climb in ~35 days vs ~52.
 *
 * 2026-07-28: made one-directional (up only). Downward drift was erasing
 * the Solid South's seeded 85-90% Democratic registration over ~800 turns.
 * Registration now only drifts up; the decay mechanism (0.004/turn) still
 * provides a slow downward pressure that active parties can recapture.
 *
 * 2026-08-30: the climb is sourced from over-registered parties once the
 * state's Independent + Unregistered pool is empty (`sourceFromSurplus`).
 * Every US pool had been at 0 since live turn ~140, and the ticket-1133
 * capacity cap then scaled every climb to zero, so Reg was frozen against
 * parties that had built Org. Pacing at this rate: two organised challengers
 * pull a 77% incumbent to ~57% in ~200 turns, matching
 * `STRONGHOLD_FALL_TIME_TURNS_TARGET`; a state with no party below its Org
 * still does not move.
 */
export const PASSIVE_REG_DRIFT_RATE = 0.06 as const;

/**
 * Passive Reg% decay / erosion per turn. Independent of drift — Reg loses
 * a small amount each turn unless actively maintained, regardless of where
 * Org sits. Routes via the 10% Org eligibility rule (`§8.3 step 4`) to
 * other parties or non-party buckets.
 *
 * Bounds: percent points per hourly turn.
 */
export const PASSIVE_REG_DECAY_RATE = 0.004 as const;

/**
 * Eligibility threshold for a party to "catch" drifted Reg.
 * Parties below this Org% in a state cannot absorb Reg from drift / decay
 * routing — the displaced share routes to non-party buckets instead
 * (Independent first, then Unregistered, with bias toward Independent).
 */
export const REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT = 10 as const;

/**
 * Independent vs Unregistered routing bias when displaced Reg goes to
 * non-party buckets. Higher = more goes to Independent. `1.0` = even split.
 *
 * Default fallback used when a country isn't listed in
 * `NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY`.
 */
export const NON_PARTY_BUCKET_INDEPENDENT_BIAS = 1.5 as const;

/**
 * Per-country: percentage points that Reg sits below Org at steady state.
 *
 * Real-world friction — not every voter the party reaches actually
 * registers with that party. The gap reflects each country's registration
 * culture:
 *   - US: strong "Independent" cultural identity, 40%+ of voters self-ID
 *     as independent → wide 5pp lag.
 *   - UK: less Independent framing, more weakly-aligned voters → 4pp.
 *   - JP: mushikutei (no-party) voters are dominant, weak party ID → 8pp.
 *   - DE: strong party ID, Stammwähler tradition, list-based politics → 3pp.
 *
 * Countries absent from this map default to 0 (Reg targets Org exactly).
 * Floor: target = `max(0, Org − lag)` so tiny-Org parties don't target
 * negative Reg.
 *
 * Decoupled 2026-06-18 (D4a): the per-country lags (US 5 / UK 4 / JP 8 / DE 3)
 * pinned Reg several points below Org, which — on top of Org itself rarely
 * exceeding ~40 — kept live Reg in the 13–32 band where the election Reg curves
 * barely bite. Removing the lag lets the passive equilibrium reach Org; the
 * active Registration Drive (Phase 6) + raised home-field cap carry committed
 * parties into the high-resistance band. The map is retained as a tunable
 * (empty = no lag, Reg targets Org); per-country friction can be reintroduced
 * later if desired.
 */
export const REG_LAG_BELOW_ORG_PCT_BY_COUNTRY: Partial<Record<CountryId, number>> = {};

/**
 * Per-country: Independent vs Unregistered routing bias for displaced Reg.
 * Higher = more goes to Independent.
 *
 *   - US 2.33 → 70% Independent (strong cultural identity)
 *   - UK 1.00 → 50/50 split (mixed culture)
 *   - JP 1.50 → 60% Independent (mushikutei has identity but less so)
 *   - DE 0.43 → 30% Independent (Nichtwähler / non-voting more common)
 *
 * Countries absent from this map fall back to `NON_PARTY_BUCKET_INDEPENDENT_BIAS`.
 */
export const NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY: Partial<Record<CountryId, number>> = {
  US: 7 / 3,
  UK: 1,
  JP: 1.5,
  DE: 3 / 7,
};

/**
 * Soft pacing target (documentation only — not consumed by mutation
 * logic). Expected number of hourly turns for a Strong stronghold to be
 * moved to a Lean tier by sustained external attack. Calibrated in the
 * Balance Appendix; exported so playtest tooling has one canonical
 * reference.
 *
 * Range: ~150-300 turns (about a week to two weeks of sustained
 * coordinated effort against an unmanned default).
 */
export const STRONGHOLD_FALL_TIME_TURNS_TARGET = 200 as const;

/**
 * Governor home-field: while a party holds the state executive, its Reg is
 * defended. Scaled by the executive's magnitude band (sign 1/2/3). Tune-later.
 */
/** Per-band fraction by which the governor party's passive Reg decay is reduced. */
export const HOME_FIELD_DECAY_RELIEF = 0.25 as const;
/** Per-band extra upward Reg drift (pp/turn) for the governor party. */
export const HOME_FIELD_DRIFT_BONUS = 0.01 as const;
/**
 * Ceiling: the gov-driven upward drift never pushes Reg above this value.
 *
 * Raised 60 → 75 (2026-06-18 D4a) so a party sustaining the state executive can
 * build Reg into the high-resistance band where the election Reg curves bite —
 * headroom the lag-decouple + active Registration Drive (Phase 6) can fill.
 */
export const HOME_FIELD_REG_CAP = 75 as const;
