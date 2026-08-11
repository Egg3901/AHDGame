/**
 * Per-state median voter computation for the swing-flow engine's
 * policy-distance driver.
 *
 * Implements M1 from `2026-05-22-per-state-median-voter.md`. Replaces
 * the policy-distance driver's hard-coded `(0, 0)` reference with a
 * turnout-weighted average of the state's demographic group leans so a
 * centrist candidate is judged relative to the state's actual median
 * voter, not abstract national neutrality.
 *
 * Pure function; safe for both server and client. The math is a weighted
 * average — not a statistical median — because per-voter modeling isn't
 * part of this engine's architecture. The weighted-average proxy
 * captures the *direction* of shift, which is what the driver needs.
 *
 * See `policyDistanceDriver` in `persuasionDrivers.ts` for the consumer.
 */

import type { DemographicCategory, StateDemographics } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface MedianVoter {
  /** Economic position weighted median, scaled to the ±4 EP grid. */
  ep: number;
  /** Social position weighted median, scaled to the ±4 SP grid. */
  sp: number;
}

/**
 * Compute the turnout-weighted average of group leans across all
 * demographic categories. Returns `{ ep: 0, sp: 0 }` for mirror-
 * symmetric demographics (the abstract-neutrality default), positive
 * values for right-leaning electorates, negative for left-leaning.
 *
 * Args:
 *   - `demographics`: state-level group composition + category weights.
 *     Per-group `economicLean` / `socialLean` are read from
 *     `demographics.groups[g].economicLean / socialLean`, falling back
 *     to the category's `defaultEconomicLean / defaultSocialLean` when
 *     a state-level override isn't present.
 *   - `categories`: the canonical demographic-category list (for group
 *     defaults + ID iteration).
 *   - `liveTurnouts`: optional per-group turnout override map (keyed by
 *     group id) — GOTV / suppression effects shift the median in the
 *     direction of boosted / suppressed groups. When omitted, the
 *     state-level `turnout` field on each group is used, falling back
 *     to the category default.
 *
 * Edge cases:
 *   - Zero total weight (no groups, no turnout) → returns `{ ep: 0, sp: 0 }`.
 *   - Negative or non-finite intermediate values are clamped defensively.
 */
export function computeMedianVoter(
  demographics: StateDemographics,
  categories: DemographicCategory[],
  liveTurnouts?: Record<string, number>
): MedianVoter {
  let weightSum = 0;
  let epWeighted = 0;
  let spWeighted = 0;

  for (const category of categories) {
    const catWeight = demographics.categoryWeights[category._id] ?? 0;
    if (!Number.isFinite(catWeight) || catWeight <= 0) continue;

    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const populationPct = stateGroup?.population;
      if (
        typeof populationPct !== "number" ||
        !Number.isFinite(populationPct) ||
        populationPct <= 0
      )
        continue;

      const turnoutPct =
        liveTurnouts?.[group.id] ??
        (typeof stateGroup?.turnout === "number" ? stateGroup.turnout : group.defaultTurnout) ??
        55;
      if (!Number.isFinite(turnoutPct) || turnoutPct <= 0) continue;

      const groupEP =
        typeof stateGroup?.economicLean === "number"
          ? stateGroup.economicLean
          : group.defaultEconomicLean;
      const groupSP =
        typeof stateGroup?.socialLean === "number"
          ? stateGroup.socialLean
          : group.defaultSocialLean;

      const w = catWeight * populationPct * turnoutPct;
      weightSum += w;
      epWeighted += w * groupEP;
      spWeighted += w * groupSP;
    }
  }

  if (weightSum <= 0) return { ep: 0, sp: 0 };
  return {
    ep: epWeighted / weightSum,
    sp: spWeighted / weightSum,
  };
}

/**
 * Per-country mapping of (electionType) that uses the EV-weighted
 * national median for the policy-distance driver instead of the
 * seat's own state median. Currently only US president — the US's
 * electoral-college system is the only one in-game where the
 * "median voter campaigns court" is meaningfully different from
 * raw national population. Non-US head-of-government races (UK PM,
 * DE chancellor, JP shugiin) wire in a later sub-phase.
 */
const EV_WEIGHTED_HEAD_OF_GOVERNMENT_BY_COUNTRY: Readonly<Partial<Record<CountryId, string>>> = {
  US: "president",
};

/**
 * True when the country uses an EV-weighted national median for the
 * given election type. Caller is expected to invoke
 * `computeNationalEvWeightedMedian` instead of `computeMedianVoter`
 * when this returns true.
 */
export function usesEvWeightedNationalMedian(electionType: string, countryId: CountryId): boolean {
  return EV_WEIGHTED_HEAD_OF_GOVERNMENT_BY_COUNTRY[countryId] === electionType;
}

/**
 * EV-weighted national median voter for US presidential elections.
 *
 * Per-state `computeMedianVoter` results aggregated by electoral-vote
 * weight: a 55-EV state pulls the national signal 55× harder than a
 * 3-EV state. Reflects the campaigning reality — candidates court the
 * EV map, not raw population. Population and turnout are already folded
 * in by `computeMedianVoter` at the per-state level, so we don't double-
 * count them.
 *
 * Args:
 *   - `states`: list of state entries to aggregate over. Each entry
 *     supplies its own `StateDemographics`, the `liveTurnouts` map for
 *     that state (or undefined to fall back to stored turnouts), and the
 *     `ev` count for the EV weight.
 *   - `categories`: shared canonical demographic-category list.
 *
 * Edge cases:
 *   - Empty states or zero total EV → returns `{ ep: 0, sp: 0 }`, matching
 *     the per-state helper's neutral default so the policy-distance
 *     driver falls back cleanly.
 *   - States whose median itself collapses to the `(0, 0)` neutral
 *     (mirror-symmetric demographics) contribute zero shift but still
 *     count toward the denominator — preserves the "EV-weighted average"
 *     framing without inflating other states' pull.
 */
export function computeNationalEvWeightedMedian(
  states: Array<{
    demographics: StateDemographics;
    liveTurnouts?: Record<string, number>;
    ev: number;
  }>,
  categories: DemographicCategory[]
): MedianVoter {
  let evSum = 0;
  let epWeighted = 0;
  let spWeighted = 0;

  for (const { demographics, liveTurnouts, ev } of states) {
    if (!Number.isFinite(ev) || ev <= 0) continue;
    const stateMedian = computeMedianVoter(demographics, categories, liveTurnouts);
    evSum += ev;
    epWeighted += ev * stateMedian.ep;
    spWeighted += ev * stateMedian.sp;
  }

  if (evSum <= 0) return { ep: 0, sp: 0 };
  return {
    ep: epWeighted / evSum,
    sp: spWeighted / evSum,
  };
}
