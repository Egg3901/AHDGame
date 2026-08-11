import type { PoliticalMetricId } from "./types";

/**
 * Cabinet → political-metrics residual driver channel.
 *
 * Standing cabinet effects (tier settings, ministerial orders, advocacy, the
 * military force effect) are computed as additive per-turn StateMetrics deltas.
 * For the political-pipeline countries (US/UK/RU/DD) those deltas are dropped from
 * stateMetrics; this module maps them onto political-metric families and folds them
 * into a decaying `cabinetResiduals` offset that the dynamics step adds on top of the
 * day-one `residuals` in composeTarget. Spec:
 * docs/superpowers/specs/2026-07-23-cabinet-political-residual-channel-design.md
 */

/** Residual carry-over per turn (0.9 → ~10× steady-state, ~20-turn fade). */
export const CABINET_RESIDUAL_DECAY = 0.9;
/** Absolute clamp so the channel stays a nudge under laws (which command up to ~62 pts). */
export const CABINET_RESIDUAL_CAP = 8;
/** Scales the tiny StateMetrics deltas (~0.02–0.08) up to a meaningful political nudge. */
export const CABINET_POLITICAL_GAIN = 20;

/**
 * StateMetrics bare key → political families with SIGNED weights. Sign inverts
 * "bad-when-high" metrics so a cabinet effect that IMPROVES a StateMetric always
 * STRENGTHENS the political family (an order reducing `crimeRate` carries a negative
 * delta; weight −1 makes it a positive push on `order.safety`). Keys with no clean
 * political analog are omitted. This table is game-design judgment, tunable freely.
 */
export const CABINET_KEY_TO_POLITICAL: Partial<
  Record<string, Array<{ id: PoliticalMetricId; weight: number }>>
> = {
  // — economy —
  gdpGrowth: [
    { id: "economy.productivity", weight: 0.5 },
    { id: "economy.householdIncome", weight: 0.5 },
  ],
  medianIncome: [{ id: "economy.householdIncome", weight: 1 }],
  incomeInequality: [{ id: "economy.mobility", weight: -1 }],
  unemploymentRate: [{ id: "economy.workerSecurity", weight: -1 }],
  povertyRate: [
    { id: "economy.householdIncome", weight: -0.7 },
    { id: "society.socialMobility", weight: -0.3 },
  ],
  costOfLiving: [{ id: "economy.householdIncome", weight: -0.5 }],
  affordabilityIndex: [{ id: "economy.householdIncome", weight: 0.5 }],
  smallBusinessFormation: [{ id: "economy.competition", weight: 1 }],
  commercialValueIndex: [
    { id: "economy.competition", weight: 0.5 },
    { id: "economy.productivity", weight: 0.5 },
  ],
  workforceSkill: [
    { id: "economy.productivity", weight: 0.5 },
    { id: "education.adultSkills", weight: 0.5 },
  ],
  budgetBalance: [{ id: "economy.fiscal", weight: 1 }],
  propertyValueIndex: [{ id: "infrastructure.ownership", weight: 0.5 }],
  infrastructureInvestmentGap: [{ id: "infrastructure.condition", weight: -1 }],
  // interestRate, inflationPressure → monetary, routed to central bank; NOT mapped.

  // — education —
  educationSpending: [
    { id: "education.universalSchooling", weight: 0.5 },
    { id: "education.teacherCorps", weight: 0.5 },
  ],
  highSchoolGradRate: [{ id: "education.attainment", weight: 1 }],
  testPerformance: [{ id: "education.standards", weight: 1 }],
  universityEnrollment: [
    { id: "education.attainment", weight: 0.5 },
    { id: "education.adultSkills", weight: 0.5 },
  ],

  // — health —
  lifeExpectancy: [{ id: "health.outcomes", weight: 1 }],
  physicianRate: [
    { id: "health.universalCare", weight: 0.5 },
    { id: "health.systemEfficiency", weight: 0.5 },
  ],
  uninsuredRate: [{ id: "health.socialInsurance", weight: -1 }],
  preventableMortality: [{ id: "health.prevention", weight: -1 }],
  publicHealthPreparedness: [
    { id: "health.prevention", weight: 0.5 },
    { id: "health.systemEfficiency", weight: 0.5 },
  ],
  foodInsecurity: [
    { id: "health.socialInsurance", weight: -0.5 },
    { id: "economy.householdIncome", weight: -0.5 },
  ],

  // — infrastructure —
  broadbandAccess: [
    { id: "infrastructure.utilities", weight: 0.5 },
    { id: "infrastructure.development", weight: 0.5 },
  ],
  publicTransit: [{ id: "infrastructure.transit", weight: 1 }],
  roadCondition: [
    { id: "infrastructure.highways", weight: 0.5 },
    { id: "infrastructure.condition", weight: 0.5 },
  ],
  powerGridReliability: [{ id: "infrastructure.utilities", weight: 1 }],
  homelessnessRate: [
    { id: "infrastructure.publicHousing", weight: -0.7 },
    { id: "society.socialMobility", weight: -0.3 },
  ],

  // — order (public safety) —
  crimeRate: [{ id: "order.safety", weight: -1 }],
  violentCrimeRate: [{ id: "order.safety", weight: -1 }],
  publicSafetyConfidence: [
    { id: "order.communityTrust", weight: 0.7 },
    { id: "order.safety", weight: 0.3 },
  ],
  incarcerationRate: [
    { id: "order.deterrence", weight: 0.5 },
    { id: "order.dueProcess", weight: -0.5 },
  ],
  recidivismRate: [{ id: "order.courts", weight: -1 }],

  // — environment —
  airQuality: [{ id: "environment.urbanAir", weight: 1 }],
  carbonEmissions: [{ id: "environment.stewardship", weight: -1 }],
  renewableEnergy: [
    { id: "environment.energySecurity", weight: 0.5 },
    { id: "environment.stewardship", weight: 0.5 },
  ],
  protectedLand: [{ id: "environment.conservation", weight: 1 }],
  recyclingRate: [{ id: "environment.stewardship", weight: 0.5 }],
  climateResilience: [
    { id: "environment.stewardship", weight: 0.5 },
    { id: "environment.conservation", weight: 0.5 },
  ],

  // — society —
  socialCohesion: [
    { id: "society.civicLife", weight: 0.6 },
    { id: "society.integration", weight: 0.4 },
  ],
  socialMobility: [{ id: "society.socialMobility", weight: 1 }],
  civicParticipation: [
    { id: "society.civicLife", weight: 0.7 },
    { id: "governance.participation", weight: 0.3 },
  ],
  populationGrowth: [{ id: "society.demography", weight: 1 }],
  migrationRate: [
    { id: "society.integration", weight: 0.5 },
    { id: "society.demography", weight: 0.5 },
  ],

  // — governance —
  publicTrust: [
    { id: "governance.integrity", weight: 0.6 },
    { id: "governance.participation", weight: 0.4 },
  ],
  corruptionIndex: [{ id: "governance.integrity", weight: -1 }],
  governmentTransparency: [{ id: "governance.openness", weight: 1 }],
  pressFreedom: [{ id: "governance.openness", weight: 1 }],
  mediaPolarization: [
    { id: "governance.openness", weight: -0.5 },
    { id: "society.civicLife", weight: -0.5 },
  ],
  devolutionSatisfaction: [{ id: "governance.localAutonomy", weight: 1 }],

  // Deliberately unmapped (outcome/monetary, no clean political driver):
  //   governmentApproval (an outcome, not a lever), interestRate, inflationPressure.
};

/** dotted "category.metricId" (optionally ".value") → bare metricId. */
function bareKey(path: string): string {
  const parts = path.split(".");
  const tail = parts[parts.length - 1] === "value" ? parts.slice(0, -1) : parts;
  return tail[tail.length - 1] ?? path;
}

/** Map national StateMetrics deltas to political-family contributions (× weight × gain). */
export function mapCabinetDeltasToPolitical(
  nationalDeltas: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, delta] of Object.entries(nationalDeltas)) {
    if (!delta) continue;
    const targets = CABINET_KEY_TO_POLITICAL[bareKey(path)];
    if (!targets) continue;
    for (const { id, weight } of targets) {
      out[id] = (out[id] ?? 0) + delta * weight * CABINET_POLITICAL_GAIN;
    }
  }
  return out;
}

/** Additively merge two political-contribution maps (points/turn). */
export function addContributions(
  a: Record<string, number>,
  b: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [id, v] of Object.entries(b)) out[id] = (out[id] ?? 0) + v;
  return out;
}

/** next = clamp(prev·DECAY + contribution, ±CAP) per id; drops ids that fade to ≈0. */
export function foldCabinetResiduals(
  prev: Record<string, number>,
  contribution: Record<string, number>
): Record<string, number> {
  const ids = new Set([...Object.keys(prev), ...Object.keys(contribution)]);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const raw = (prev[id] ?? 0) * CABINET_RESIDUAL_DECAY + (contribution[id] ?? 0);
    const capped = Math.max(-CABINET_RESIDUAL_CAP, Math.min(CABINET_RESIDUAL_CAP, raw));
    if (Math.abs(capped) >= 0.01) out[id] = +capped.toFixed(4);
  }
  return out;
}
