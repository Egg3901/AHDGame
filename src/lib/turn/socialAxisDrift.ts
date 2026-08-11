import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, COUNTRY_ORDER } from "@/lib/constants/countries";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { logger } from "../observability/logger";

/**
 * Per-law EMA pull toward the enacted option's social stance. 0.05 moves a
 * country ~0.25 for a single max-distance law, so ~15–20 aligned social laws
 * traverse the axis — slow enough that the position reflects a sustained
 * legislative posture, not a single bill. First-pass balance constant (P6b).
 */
export const SOCIAL_AXIS_DRIFT_RATE = 0.05;

/** Net per-turn cap so a same-turn bill barrage can't lurch the axis. */
export const SOCIAL_AXIS_MAX_DRIFT_PER_TURN = 0.5;

const AXIS_MIN = -5;
const AXIS_MAX = 5;

export interface SocialAxisDriftResult {
  countriesProcessed: number;
  lawsCounted: number;
}

interface NationalPolicyRow {
  legislationTypeId: string;
  social?: number;
}

interface LegislationTypeOptionsRow {
  _id: string;
  policyOptions?: Array<{ social?: number }>;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Drift each country's social-axis position (−5 libertarian … +5
 * authoritarian) toward the social stance of national laws enacted since the
 * stored watermark. A law qualifies only when its legislation type's option
 * set is socially differentiated (some option has a non-zero `social` score):
 * economic-only laws must not drag the axis toward center, but a centrist
 * option of a genuinely social law DOES moderate it. The position always
 * writes, so the field self-heals onto countryState docs created before P6b.
 *
 * Sequential turn phase: reads the statePolicies rows the bill-lifecycle
 * phases wrote earlier this turn, so it must run after bill enactment.
 *
 * `enactmentTurn` is the turn the bill phases stamp onto enacted policies —
 * i.e. `gameState.currentTurn`, which the turn system only advances AFTER all
 * phases run. Passing `newTurn` here would off-by-one past every enactment.
 */
export async function processSocialAxisDrift(
  db: Db,
  enactmentTurn: number
): Promise<SocialAxisDriftResult> {
  let countriesProcessed = 0;
  let lawsCounted = 0;

  for (const countryId of COUNTRY_ORDER) {
    // Isolate each country: a single country's read/write failure must not
    // abort drift for the others (mirrors getCountryState's defensive shape).
    try {
      const cfg = COUNTRY_CONFIGS[countryId];
      const state = await getCountryState(db, countryId);
      const position = state.socialAxisPosition ?? cfg.socialAxisBaseline ?? 0;
      // First run starts at the previous turn so laws enacted in THIS turn's
      // bill phases (stamped enactedTurn = enactmentTurn) are counted once.
      const watermark = state.socialAxisDriftTurn ?? enactmentTurn - 1;

      const rows = await db
        .collection<NationalPolicyRow>("statePolicies")
        .find({
          stateId: getNationalStateId(countryId),
          enactedTurn: { $gt: watermark, $lte: enactmentTurn },
        })
        .project<NationalPolicyRow>({ legislationTypeId: 1, social: 1 })
        .toArray();

      let delta = 0;
      let counted = 0;
      if (rows.length > 0) {
        const typeIds = [...new Set(rows.map((r) => r.legislationTypeId))];
        const types = await db
          .collection<LegislationTypeOptionsRow>("legislationTypes")
          .find({ _id: { $in: typeIds } })
          .project<LegislationTypeOptionsRow>({ policyOptions: 1 })
          .toArray();
        const sociallyDifferentiated = new Set(
          types
            .filter((t) => (t.policyOptions ?? []).some((o) => (o.social ?? 0) !== 0))
            .map((t) => String(t._id))
        );
        for (const row of rows) {
          if (!sociallyDifferentiated.has(row.legislationTypeId)) continue;
          delta += SOCIAL_AXIS_DRIFT_RATE * ((row.social ?? 0) - position);
          counted++;
        }
      }

      delta = clamp(delta, -SOCIAL_AXIS_MAX_DRIFT_PER_TURN, SOCIAL_AXIS_MAX_DRIFT_PER_TURN);
      const next = clamp(position + delta, AXIS_MIN, AXIS_MAX);

      await updateCountryState(db, countryId, {
        socialAxisPosition: Math.round(next * 100) / 100,
        socialAxisDriftTurn: enactmentTurn,
      });
      countriesProcessed++;
      lawsCounted += counted;
    } catch (err) {
      logger.error("socialAxisDrift", `skipped ${countryId}`, err);
    }
  }

  return { countriesProcessed, lawsCounted };
}
