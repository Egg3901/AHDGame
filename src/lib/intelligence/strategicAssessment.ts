import {
  ASSESS_ESTIMATE_COVERAGE,
  ASSESS_EXACT_COVERAGE,
  ASSESS_EXISTENCE_COVERAGE,
} from "./config";
import { fogInteger } from "./fog";

/** How much of a target's nuclear posture the current coverage buys. */
export type AssessmentTier = "none" | "existence" | "estimate" | "exact";

/** The truth, as the server holds it. Never served: this is the INPUT. */
export interface NuclearFacts {
  hasProgramme: boolean;
  warheads: number;
  adoptedNodeCount: number;
  /** Null when the target cannot run a covert programme at all. */
  covert: { active: boolean; stage: number; stageCount: number } | null;
}

/** What an operator is allowed to know. Every field is null until earned. */
export interface NuclearAssessment {
  tier: AssessmentTier;
  /** Null below existence tier: you do not even know whether there is one. */
  hasProgramme: boolean | null;
  warheads: number | null;
  /** True while `warheads` is a fogged estimate rather than a count. */
  warheadsAreEstimate: boolean;
  adoptedNodeCount: number | null;
  /** A hint that something undeclared is running. Not the stage. */
  covertSuspected: boolean;
  /** The actual stage, at the exact tier only. */
  covertStage: number | null;
  covertStageCount: number | null;
}

export function assessmentTier(coverage: number): AssessmentTier {
  if (!Number.isFinite(coverage)) return "none";
  if (coverage >= ASSESS_EXACT_COVERAGE) return "exact";
  if (coverage >= ASSESS_ESTIMATE_COVERAGE) return "estimate";
  if (coverage >= ASSESS_EXISTENCE_COVERAGE) return "existence";
  return "none";
}

/**
 * Grade what a service knows about a target's nuclear posture.
 *
 * Pure, and the caller passes the turn so the fog is stable per window rather
 * than re-rolled on every read. Nothing here reads the database, and the fog
 * FACTOR never leaves: serving it would make every estimate invertible.
 *
 * The tiers are deliberately coarse. "There is a programme" is worth a lot on
 * its own in a world where the alternative is guessing, and an exact warhead
 * count should cost real, sustained coverage rather than one lucky operation.
 */
export function assessNuclear(
  facts: NuclearFacts,
  coverage: number,
  subject: string,
  turn: number
): NuclearAssessment {
  const tier = assessmentTier(coverage);

  if (tier === "none") {
    return {
      tier,
      hasProgramme: null,
      warheads: null,
      warheadsAreEstimate: false,
      adoptedNodeCount: null,
      covertSuspected: false,
      covertStage: null,
      covertStageCount: null,
    };
  }

  // Existence tier answers one question, and answers it either way: learning
  // that a country has NO programme is intelligence too.
  if (tier === "existence") {
    return {
      tier,
      hasProgramme: facts.hasProgramme,
      warheads: null,
      warheadsAreEstimate: false,
      adoptedNodeCount: null,
      covertSuspected: false,
      covertStage: null,
      covertStageCount: null,
    };
  }

  // A covert programme is only ever SUSPECTED until the exact tier. That is the
  // point of running it covertly: the shape shows before the substance.
  const covertSuspected = facts.covert?.active === true;

  if (tier === "estimate") {
    return {
      tier,
      hasProgramme: facts.hasProgramme,
      // Salted per figure: two estimates sharing a factor would publish their
      // exact ratio, because the factor cancels.
      warheads: fogInteger(facts.warheads, subject, turn, "warheads"),
      warheadsAreEstimate: true,
      adoptedNodeCount: fogInteger(facts.adoptedNodeCount, subject, turn, "nodes"),
      covertSuspected,
      covertStage: null,
      covertStageCount: null,
    };
  }

  return {
    tier,
    hasProgramme: facts.hasProgramme,
    warheads: facts.warheads,
    warheadsAreEstimate: false,
    adoptedNodeCount: facts.adoptedNodeCount,
    covertSuspected,
    covertStage: facts.covert?.active ? facts.covert.stage : null,
    covertStageCount: facts.covert?.active ? facts.covert.stageCount : null,
  };
}
