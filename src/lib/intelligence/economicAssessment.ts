import { fogInteger } from "./fog";
import { assessmentTier, type AssessmentTier } from "./strategicAssessment";

/** The truth, as the server holds it. Never served: this is the INPUT. */
export interface EconomicFacts {
  corporationCount: number;
  publicCount: number;
  /** Summed liquid capital across the country's corporations. */
  aggregateLiquidCapital: number;
}

/** What an operator is allowed to know. Every field is null until earned. */
export interface EconomicAssessment {
  tier: AssessmentTier;
  /** Null below existence tier: you do not know whether they have an economy worth the name. */
  hasCorporateSector: boolean | null;
  corporationCount: number | null;
  publicCount: number | null;
  aggregateLiquidCapital: number | null;
  figuresAreEstimate: boolean;
}

/**
 * Grade what a service knows about a target's corporate sector.
 *
 * The NATIONAL picture only. Seeing through one company's books is a separate,
 * deliberate act (the leak operation), not something a coverage threshold hands
 * over wholesale: `financialFogOfWar` exists to keep a rival out of a specific
 * company's accounts, and quietly dissolving it for every corporation in a
 * country at once would retire that module by the back door.
 */
export function assessEconomic(
  facts: EconomicFacts,
  coverage: number,
  subject: string,
  turn: number
): EconomicAssessment {
  const tier = assessmentTier(coverage);

  if (tier === "none") {
    return {
      tier,
      hasCorporateSector: null,
      corporationCount: null,
      publicCount: null,
      aggregateLiquidCapital: null,
      figuresAreEstimate: false,
    };
  }

  if (tier === "existence") {
    return {
      tier,
      hasCorporateSector: facts.corporationCount > 0,
      corporationCount: null,
      publicCount: null,
      aggregateLiquidCapital: null,
      figuresAreEstimate: false,
    };
  }

  if (tier === "estimate") {
    return {
      tier,
      hasCorporateSector: facts.corporationCount > 0,
      // Salted per figure. A shared factor would publish the exact ratio of
      // listed to unlisted companies, and of capital to company count.
      corporationCount: fogInteger(facts.corporationCount, subject, turn, "corps"),
      publicCount: fogInteger(facts.publicCount, subject, turn, "listed"),
      aggregateLiquidCapital: fogInteger(facts.aggregateLiquidCapital, subject, turn, "capital"),
      figuresAreEstimate: true,
    };
  }

  return {
    tier,
    hasCorporateSector: facts.corporationCount > 0,
    corporationCount: facts.corporationCount,
    publicCount: facts.publicCount,
    aggregateLiquidCapital: Math.round(facts.aggregateLiquidCapital),
    figuresAreEstimate: false,
  };
}
