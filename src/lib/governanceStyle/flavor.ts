import type { GovernanceStyleScore } from "./score";

export interface GovernanceStyleFlavor {
  headline: string;
  institutionalNarrative: string;
  politicalHeadline: string;
  politicalNarrative: string;
  institutionalSigns: readonly [string, string, string];
  competitionNarrative: string | null;
}

/*
 * Bands of the 0..100 Democratic Health score. Below 60 the score costs the
 * country potential GDP growth, adds interest to newly issued government bonds
 * and cuts the president's party's share in presidential elections, all scaled
 * by `democraticHealthPressure` (governanceStyle/rules/democraticConsequences).
 * The ranges quoted below are that function evaluated at each band's edges.
 */
const HEALTH_FLAVOR = [
  {
    max: 20,
    headline: "Institutions in Name Only",
    narrative:
      "Democratic Health is below 20. Potential GDP growth is 2.5 to 4 percentage points lower, newly issued government bonds pay 1.2 to 2 percentage points more interest, and in presidential elections the president's party has its vote share cut by 12% to 20%. A sitting president on the ballot loses up to a further 10%. Each penalty grows as the score falls.",
    signs: [
      "Potential GDP growth is 2.5 to 4 percentage points lower.",
      "New government bonds pay 1.2 to 2 percentage points more interest.",
      "The president's party has its presidential vote cut by 12% to 20%.",
    ] as const,
  },
  {
    max: 40,
    headline: "The Hollowing Republic",
    narrative:
      "Democratic Health is between 20 and 40. Potential GDP growth is 1.1 to 2.5 percentage points lower, newly issued government bonds pay 0.5 to 1.2 percentage points more interest, and in presidential elections the president's party has its vote share cut by 5% to 12%. A sitting president on the ballot loses up to a further 6%. Each penalty grows as the score falls.",
    signs: [
      "Potential GDP growth is 1.1 to 2.5 percentage points lower.",
      "New government bonds pay 0.5 to 1.2 percentage points more interest.",
      "The president's party has its presidential vote cut by 5% to 12%.",
    ] as const,
  },
  {
    max: 60,
    headline: "Democracy Under Strain",
    narrative:
      "Democratic Health is between 40 and 60. Penalties start below 60 and are still small here: potential GDP growth is up to 1.1 percentage points lower, newly issued government bonds pay up to 0.5 percentage points more interest, and in presidential elections the president's party has its vote share cut by up to 5%. A sitting president on the ballot loses up to a further 3%.",
    signs: [
      "Potential GDP growth is up to 1.1 percentage points lower.",
      "New government bonds pay up to 0.5 percentage points more interest.",
      "The president's party has its presidential vote cut by up to 5%.",
    ] as const,
  },
  {
    max: 80,
    headline: "Living Institutions",
    narrative:
      "Democratic Health is between 60 and 80, so no penalties apply. Below 60, potential GDP growth falls, new government bonds pay more interest, and the president's party loses vote share in presidential elections.",
    signs: [
      "No penalties apply while the score stays at 60 or above.",
      "Potential GDP growth carries no institutional penalty.",
      "New government bonds pay no extra interest.",
    ] as const,
  },
  {
    max: 101,
    headline: "Democratic Renewal",
    narrative:
      "Democratic Health is 80 or higher, at least 20 points above the level where penalties begin. Growth, government borrowing and presidential elections carry no institutional penalty.",
    signs: [
      "No penalties apply, and the score is at least 20 points clear of them.",
      "Potential GDP growth carries no institutional penalty.",
      "New government bonds pay no extra interest.",
    ] as const,
  },
] as const;

/*
 * Bands of the 0..100 political-direction score: 50 plus the average lead of
 * right-leaning metric families over their left-leaning mirrors.
 */
const DIRECTION_FLAVOR = [
  {
    max: 20,
    headline: "Transformative Left",
    narrative:
      "Left-leaning political metrics outscore their right-leaning counterparts by more than 30 points on average.",
  },
  {
    max: 47,
    headline: "Social Consensus",
    narrative:
      "Left-leaning political metrics outscore their right-leaning counterparts by 3 to 30 points on average.",
  },
  {
    max: 53.01,
    headline: "Civic Balance",
    narrative:
      "Left-leaning and right-leaning political metrics are within 3 points of each other on average.",
  },
  {
    max: 80,
    headline: "Conservative Consensus",
    narrative:
      "Right-leaning political metrics outscore their left-leaning counterparts by 3 to 30 points on average.",
  },
  {
    max: 101,
    headline: "Restorative Right",
    narrative:
      "Right-leaning political metrics outscore their left-leaning counterparts by 30 or more points on average.",
  },
] as const;

export function governanceStyleFlavor(score: GovernanceStyleScore): GovernanceStyleFlavor {
  const health = HEALTH_FLAVOR.find((entry) => score.democraticHealth.value < entry.max)!;
  const direction = DIRECTION_FLAVOR.find((entry) => score.leftRight.value < entry.max)!;
  const competition = score.competition;
  let competitionNarrative: string | null = null;
  if (competition && competition.dominantSeatShare > 0) {
    const chamberScope =
      competition.chambersMeasured === 1
        ? "in the elected chamber"
        : `across ${competition.chambersMeasured} elected chambers`;
    const executiveStatus =
      competition.executiveAlignedWithLegislature === true
        ? ` The same party has also held the presidency for ${competition.consecutiveExecutiveTerms} consecutive ${competition.consecutiveExecutiveTerms === 1 ? "term" : "terms"}.`
        : competition.executiveAlignedWithLegislature === false
          ? " A rival party holds the presidency, so executive continuity adds no penalty."
          : competition.uninterruptedControlTurns > 0
            ? ` Its uninterrupted legislative lead has lasted ${competition.uninterruptedControlTurns} turns.`
            : "";
    const courtStatus =
      competition.courtPenalty > 0
        ? ` The Supreme Court is ${competition.courtDominantShare.toFixed(1)}% one party among ${competition.courtSeated} seated justices, which subtracts ${competition.courtPenalty.toFixed(1)} points.`
        : competition.courtSeated >= 5
          ? " The Supreme Court is split enough to add no penalty."
          : "";
    competitionNarrative =
      competition.penalty > 0
        ? `One party averages ${competition.dominantSeatShare.toFixed(1)}% control ${chamberScope}.${executiveStatus}${courtStatus} Chamber margins subtract ${competition.seatMarginPenalty.toFixed(1)} points, legislative continuity subtracts ${competition.legislativeContinuityPenalty.toFixed(1)}, executive continuity subtracts ${competition.executiveContinuityPenalty.toFixed(1)}, and the Court subtracts ${competition.courtPenalty.toFixed(1)}, for a total democratic-health penalty of ${competition.penalty.toFixed(1)}.`
        : `The largest party averages ${competition.dominantSeatShare.toFixed(1)}% control ${chamberScope}.${executiveStatus}${courtStatus} Competitive balance applies no democratic-health penalty.`;
  }
  return {
    headline: health.headline,
    institutionalNarrative: health.narrative,
    politicalHeadline: direction.headline,
    politicalNarrative: direction.narrative,
    institutionalSigns: health.signs,
    competitionNarrative,
  };
}
