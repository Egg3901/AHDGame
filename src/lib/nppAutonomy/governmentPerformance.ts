/**
 * governmentPerformance — the accountability half of the agenda loop.
 *
 * The agenda sets targets; this scores how well the government actually hit them
 * and feeds the result back into the governing party's standing. A government
 * that meets its agenda gains favorability (→ electability); one that misses is
 * punished — closing the loop the plan's "done bar" requires ("punished at
 * elections for missed targets").
 *
 * The score is pure + deterministic; the nudge is a single clamped favorability
 * update over the governing party.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types";
import type { GoverningAgendaItem } from "./governingAgenda";

/** Priority-weighted target attainment at/above which the government is "par". */
const PERF_NEUTRAL = 0.6;
/** Converts the attainment gap into a favorability delta. */
const PERF_SENSITIVITY = 10;
/** Hard cap on the per-evaluation favorability swing (bounded, like everything). */
const PERF_MAX_DELTA = 4;

export interface GovernmentPerformance {
  /** Priority-weighted target attainment in [0,1] (1 = every goal met). */
  score: number;
  /** Favorability delta for the governing party this evaluation, in [-4, +4]. */
  favorabilityDelta: number;
}

/**
 * Score the government against its agenda: each "raise" goal's attainment is
 * `health / target` (clamped to 1); each "lower" goal's attainment mirrors it -
 * `target / health` (clamped to 1), so a domain already at or below its floor
 * scores full marks and one still sitting above it scores proportionally to
 * how much cutting remains. Priority-weighted and averaged. The delta rewards
 * beating par and punishes missing it, clamped. Goals with no measurable
 * health contribute nothing; with no measurable goals at all, the result is par
 * with no nudge. Pure.
 */
export function computeGovernmentPerformance(
  agenda: GoverningAgendaItem[],
  domainHealth: Record<string, number>
): GovernmentPerformance {
  let weightSum = 0;
  let attainSum = 0;
  for (const item of agenda) {
    if (item.direction === "hold" || item.target <= 0) continue;
    const health = domainHealth[item.domain];
    if (typeof health !== "number") continue;
    const attainment =
      item.direction === "raise"
        ? Math.max(0, Math.min(1, health / item.target))
        : Math.max(0, Math.min(1, health > 0 ? item.target / health : 1));
    attainSum += item.priority * attainment;
    weightSum += item.priority;
  }
  if (weightSum === 0) return { score: PERF_NEUTRAL, favorabilityDelta: 0 };

  const score = attainSum / weightSum;
  const favorabilityDelta = Math.max(
    -PERF_MAX_DELTA,
    Math.min(PERF_MAX_DELTA, (score - PERF_NEUTRAL) * PERF_SENSITIVITY)
  );
  return { score, favorabilityDelta };
}

/**
 * Apply the performance favorability delta to the governing party's NPPs,
 * clamped to [0, 100]. Returns the number of NPPs nudged. No-op when delta is 0.
 */
export async function applyGovernmentPerformanceNudge(
  db: Db,
  countryId: CountryId,
  governingPartyId: string,
  favorabilityDelta: number,
  now: Date
): Promise<number> {
  if (favorabilityDelta === 0) return 0;
  const res = await db
    .collection<NPP>("npps")
    .updateMany({ countryId, party: governingPartyId, retiredAt: null }, [
      {
        $set: {
          favorability: {
            $max: [
              0,
              { $min: [100, { $add: [{ $ifNull: ["$favorability", 50] }, favorabilityDelta] }] },
            ],
          },
          updatedAt: now,
        },
      },
    ]);
  return res.modifiedCount ?? 0;
}
