/**
 * Political score (0-100) → legacy metric REAL units.
 *
 * The margin adapter never needed this: margins normalize every signal to
 * quality(-1..1), so scale cancels. The demographic and TFP engines do NOT —
 * they consume years, per-100k rates, and a 97-99.9 grid band, and they read
 * those values through formulas calibrated to those units.
 *
 * Every band is centred on the value the consumer ALREADY uses when the metric
 * is absent, so a region sitting at the political neutral (50) behaves exactly
 * as it does today. That makes substitution parity-safe by construction: this
 * can only change behavior for regions whose political score is off 50, which
 * is precisely the intent.
 *
 * `inverted` marks lower-is-better legacy metrics (preventable mortality): a
 * HIGH political score must produce a LOW real-unit value.
 */
import {
  LIFE_EXPECTANCY_MID,
  LIFE_HALF_SPAN,
  PREVENTABLE_MORTALITY_MID,
  PREV_HALF_SPAN,
} from "@/lib/demographics/flows/mortality";
import { TFP_REFERENCE_INPUTS } from "@/lib/metricEngine/potentialGrowth";

export interface LegacyUnitBand {
  mid: number;
  halfSpan: number;
  /** Legacy metric is lower-is-better; a high political score maps DOWN. */
  inverted?: true;
}

/**
 * Keyed by legacy "category.metricId". Every mid is DERIVED from the consuming
 * formula's own neutral, never copied — a divergence would silently shift
 * behavior at the political neutral, defeating the parity property:
 *   - mortality: mortality.ts LIFE_/PREV_ constants (years, per-100k)
 *   - TFP inputs: TFP_REFERENCE_INPUTS, with half-spans equal to the divisors
 *     the basket already applies (skill /30, transport /45, broadband /25,
 *     grid /1.45)
 *
 * The TFP half-spans are therefore "one normalized basket unit", NOT the
 * metric's full realistic range — score 0 on the infrastructure board means
 * "one unit below reference", not "no broadband exists". These values are
 * engine inputs and are never surfaced to players.
 *
 * KNOWN, DELIBERATE: `education.workforceSkill` reads differently here than on
 * the economy page, which shows the RAW `education.adultSkills` score via
 * workforceSkillLoader. They coincide only at score 75. Do NOT "fix" this by
 * passing the raw score into the basket: score 50 would then feed 50 where the
 * engine's reference is 60, silently changing TFP for every playable region and
 * breaking the parity property this whole table exists to preserve. The display
 * shows a political score; the basket consumes a normalized TFP input. Two
 * scales, two purposes.
 */
export const LEGACY_UNIT_BANDS: Record<string, LegacyUnitBand> = {
  "healthcare.lifeExpectancy": { mid: LIFE_EXPECTANCY_MID, halfSpan: LIFE_HALF_SPAN },
  "healthcare.preventableMortality": {
    mid: PREVENTABLE_MORTALITY_MID,
    halfSpan: PREV_HALF_SPAN,
    inverted: true,
  },
  "education.workforceSkill": { mid: TFP_REFERENCE_INPUTS.workforceSkill, halfSpan: 30 },
  "infrastructure.transportEfficiency": {
    mid: TFP_REFERENCE_INPUTS.transportEfficiency,
    halfSpan: 45,
  },
  "infrastructure.broadbandAccess": { mid: TFP_REFERENCE_INPUTS.broadbandAccess, halfSpan: 25 },
  "infrastructure.powerGridReliability": {
    mid: TFP_REFERENCE_INPUTS.powerGridReliability,
    halfSpan: 1.45,
  },
};

const clampScore = (s: number) => Math.max(0, Math.min(100, s));

/** Signed -1..1 offset from the political neutral. */
const offset = (score: number) => (clampScore(score) - 50) / 50;

/**
 * Convert a political score into the legacy metric's real unit. Returns null
 * when the path has no band — callers must then fall back to their own default
 * rather than inventing one here.
 */
export function legacyUnitFromPoliticalScore(path: string, score: number): number | null {
  const band = LEGACY_UNIT_BANDS[path];
  if (!band) return null;
  const signed = offset(score) * band.halfSpan;
  return band.inverted ? band.mid - signed : band.mid + signed;
}

/**
 * Shift an AUTHORED base value by the political score, ±halfSpan at the
 * extremes and unchanged at 50. Used where the legacy value still EXISTS
 * (macroMetrics survivors like population.birthRate): the authored regional
 * character stays the base, and policy moves it — replacing outright would
 * discard seed data this system has no better substitute for.
 */
export function modulateByPoliticalScore(base: number, score: number, halfSpan: number): number {
  return base + offset(score) * halfSpan;
}
