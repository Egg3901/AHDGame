import { fogInteger } from "./fog";
import { assessmentTier, type AssessmentTier } from "./strategicAssessment";

/** The truth, as the server holds it. Never served: this is the INPUT. */
export interface MilitaryFacts {
  formationCount: number;
  /** Mean readiness across the country's formations, 0..100. */
  meanReadiness: number;
  /** Live fronts the country is a belligerent at, with its DERIVED supply. */
  fronts: Array<{ conflictId: string; supply: number }>;
}

/** What an operator is allowed to know. Every field is null until earned. */
export interface MilitaryAssessment {
  tier: AssessmentTier;
  /** Null below existence tier. */
  atWar: boolean | null;
  frontCount: number | null;
  formationCount: number | null;
  meanReadiness: number | null;
  /** True while the counts are fogged estimates rather than figures. */
  figuresAreEstimate: boolean;
  /** Per-front supply, at the exact tier only. This is targeting information. */
  fronts: Array<{ conflictId: string; supply: number }> | null;
}

/**
 * Grade what a service knows about a target's military posture.
 *
 * Pure, deterministic, and DELIBERATELY NOT a change to `conflictVisibility`.
 *
 * That module's contract is that command sight needs both a belligerent country
 * and a seat in its command structure, and its own comment explains why an
 * account flag is not a seat. Widening it so a non-belligerent with coverage
 * reads at "command" would hand an outsider exactly the order of battle that
 * module exists to withhold, and would do it for every consumer at once. An
 * intelligence service gets its own, coarser picture instead: enough to plan
 * against, never the belligerent's own console.
 *
 * Sight only. Nothing here grants authority, and `canActAtTheater` is untouched.
 */
export function assessMilitary(
  facts: MilitaryFacts,
  coverage: number,
  subject: string,
  turn: number
): MilitaryAssessment {
  const tier = assessmentTier(coverage);

  if (tier === "none") {
    return {
      tier,
      atWar: null,
      frontCount: null,
      formationCount: null,
      meanReadiness: null,
      figuresAreEstimate: false,
      fronts: null,
    };
  }

  // Existence tier answers the one question an attaché could answer: are they
  // fighting, and in how many places.
  if (tier === "existence") {
    return {
      tier,
      atWar: facts.fronts.length > 0,
      frontCount: facts.fronts.length,
      formationCount: null,
      meanReadiness: null,
      figuresAreEstimate: false,
      fronts: null,
    };
  }

  if (tier === "estimate") {
    return {
      tier,
      atWar: facts.fronts.length > 0,
      frontCount: facts.fronts.length,
      // Salted per figure: a shared factor would publish the exact ratio of
      // strength to readiness, which is most of what the estimate hides.
      formationCount: fogInteger(facts.formationCount, subject, turn, "formations"),
      meanReadiness: fogInteger(facts.meanReadiness, subject, turn, "readiness"),
      figuresAreEstimate: true,
      fronts: null,
    };
  }

  return {
    tier,
    atWar: facts.fronts.length > 0,
    frontCount: facts.fronts.length,
    formationCount: facts.formationCount,
    meanReadiness: Math.round(facts.meanReadiness),
    figuresAreEstimate: false,
    fronts: facts.fronts,
  };
}
