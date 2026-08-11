import {
  STAT_KEYS,
  STAT_FREE_POINTS,
  STAT_MAX,
  STAT_MIN,
  type CharacterStats,
  type StatKey,
} from "./statsConstants";

/**
 * Character signals used to derive a sensible suggested stat build for a
 * grandfathered character. All fields optional — a fully-empty input still
 * yields a legal build (the normalizer guarantees this).
 */
export interface SuggestBuildInput {
  /** Corporations the character owns (CEO of). */
  corpsOwned?: number;
  isCeo?: boolean;
  /** donorBaseLevel 0–75. */
  donorBaseLevel?: number;
  /** Campaign funds (local units). */
  campaignFunds?: number;
  /** Public favorability 0–100. */
  favorability?: number;
  /** Political influence 0–100. */
  politicalInfluence?: number;
  hasOffice?: boolean;
  isLeader?: boolean;
  /** Career length signal (e.g. number of career events). */
  careerLength?: number;
  /** Polls the character has run. */
  pollsRun?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Raw, non-negative weight per stat derived from character signals. */
function rawWeights(input: SuggestBuildInput): Record<StatKey, number> {
  const corps = Math.max(0, input.corpsOwned ?? 0);
  const donor = clamp(input.donorBaseLevel ?? 0, 0, 75);
  const funds = Math.max(0, input.campaignFunds ?? 0);
  const fav = clamp(input.favorability ?? 0, 0, 100);
  const pi = clamp(input.politicalInfluence ?? 0, 0, 100);
  const career = Math.max(0, input.careerLength ?? 0);
  const polls = Math.max(0, input.pollsRun ?? 0);
  const office = input.hasOffice ? 1 : 0;
  const leader = input.isLeader ? 1 : 0;

  return {
    // A small base weight on every stat keeps a zero-signal build balanced and
    // ensures Energy (the "remainder" stat) is never starved.
    businessAcumen: 0.5 + office * 0 + (input.isCeo ? 5 : 0) + Math.min(corps * 2, 10),
    fundraising: 0.5 + (donor / 75) * 10 + Math.min(funds / 100_000, 10),
    charisma: 0.5 + fav / 10 + pi / 10,
    statecraft: 0.5 + office * 5 + leader * 5,
    intellect: 0.5 + Math.min(career, 20) * 0.25 + Math.min(polls, 20) * 0.25,
    debate: 0.5 + office * 3 + Math.min(career, 20) * 0.15,
    energy: 2, // baseline so leftover free points settle on Energy
  };
}

/**
 * Compute a suggested 28-point / 1–10 build from character signals.
 *
 * Normalization: raw weights → ideal free-point share of 21 → integer
 * water-fill (each point goes to the stat with the largest remaining deficit
 * that is still below the 9-point free cap) → add the 1-floor. The result is
 * guaranteed to total 28 with every stat in [1, 10].
 */
export function suggestStatBuild(input: SuggestBuildInput): CharacterStats {
  const weights = rawWeights(input);
  const totalW = STAT_KEYS.reduce((s, k) => s + weights[k], 0);
  const freeCap = STAT_MAX - STAT_MIN; // 9 free points max per stat

  // Ideal fractional free-point share per stat.
  const ideal = {} as Record<StatKey, number>;
  for (const k of STAT_KEYS) {
    ideal[k] =
      totalW > 0 ? (weights[k] / totalW) * STAT_FREE_POINTS : STAT_FREE_POINTS / STAT_KEYS.length;
  }

  // Start at the floor of each ideal (capped), then water-fill the remainder.
  const free = {} as Record<StatKey, number>;
  for (const k of STAT_KEYS) free[k] = Math.min(freeCap, Math.floor(ideal[k]));

  let remaining = STAT_FREE_POINTS - STAT_KEYS.reduce((s, k) => s + free[k], 0);
  while (remaining > 0) {
    let best: StatKey | null = null;
    let bestDeficit = -Infinity;
    for (const k of STAT_KEYS) {
      if (free[k] >= freeCap) continue;
      const deficit = ideal[k] - free[k];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = k;
      }
    }
    if (best === null) break; // everything capped (shouldn't happen: 7×9 ≥ 21)
    free[best] += 1;
    remaining -= 1;
  }

  const stats = {} as CharacterStats;
  for (const k of STAT_KEYS) stats[k] = free[k] + STAT_MIN;
  return stats;
}
