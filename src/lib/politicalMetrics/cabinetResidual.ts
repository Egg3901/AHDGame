import type { PoliticalMetricId } from "./types";

/**
 * Cabinet → political-metrics residual driver channel.
 *
 * Standing cabinet effects (tier settings, ministerial orders, advocacy, the
 * military force effect, and sited estates) are computed as additive per-turn
 * StateMetrics deltas.
 * For the political-pipeline countries (US/UK/RU/DD) those deltas are dropped from
 * stateMetrics; this module maps them onto political-metric families and folds them
 * into a decaying `cabinetResiduals` offset that the dynamics step adds on top of the
 * day-one `residuals` in composeTarget. Spec:
 * docs/superpowers/specs/2026-07-23-cabinet-political-residual-channel-design.md
 */

/** Residual carry-over per turn (0.9 → ~10× steady-state, ~20-turn fade). */
export const CABINET_RESIDUAL_DECAY = 0.9;

/**
 * The cabinet channels a residual can come from, ticket #1129.
 *
 * Before this, every cabinet effect was summed into ONE number per metric and
 * clamped once. On prod that clamp bound 21% of US regional entries, and for
 * `society.civicLife` and `economy.competition` it bound ALL 51 states, so a
 * player who built an estate aimed at those families bought exactly zero. The
 * clamp is now applied per SOURCE, which is the granularity the turn phase
 * already computes effects at and the one a player acts on: an estate is not
 * an order and is not a tier setting, so a saturated order book must not make
 * a new estate worthless.
 *
 * These ids are persisted (`cabinetResidualsBySource`), so renaming one strands
 * that channel's stored residual and it decays away over ~20 turns. Adding one
 * raises the theoretical total ceiling by CABINET_RESIDUAL_CAP_PER_SOURCE.
 */
export const CABINET_SOURCE_IDS = [
  "orders",
  "settings",
  "military",
  "estates",
  "energy",
  "infrastructure",
] as const;
export type CabinetSourceId = (typeof CABINET_SOURCE_IDS)[number];

/**
 * Holding pen for residual that predates the per-source split. It receives no
 * new contribution, so it only ever decays. See `seedBySourceFromLegacy`.
 */
export const CABINET_LEGACY_SOURCE = "legacy";

/**
 * Absolute clamp PER SOURCE. Unchanged in value from the single global cap it
 * replaces, deliberately: raising it would have inflated every channel that is
 * already binding, and the complaint was never that a saturated channel was too
 * weak, it was that a saturated channel silenced the OTHER channels.
 *
 * Theoretical total ceiling is therefore 6 × 8 = 48 points, against the ~62 a
 * fully stacked law book commands. Both maxima need every lever in the game
 * pointed at one family: the observed prod maximum after the split is about 16
 * (economy.competition), so the channel stays well under laws in practice.
 */
export const CABINET_RESIDUAL_CAP_PER_SOURCE = 8;

/** Theoretical maximum total cabinet offset on one metric, all channels pinned. */
export const CABINET_RESIDUAL_TOTAL_CEILING =
  CABINET_RESIDUAL_CAP_PER_SOURCE * CABINET_SOURCE_IDS.length;
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
  // Same correspondence ADAPTER_TIER1 already uses for this key.
  literacyRate: [{ id: "education.universalSchooling", weight: 1 }],
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
  // society.tradition is "standing of traditional institutions and shared
  // national identity"; a House of Culture is literally its "community hall
  // construction" contributor, hence the smaller civicLife share.
  nationalPride: [
    { id: "society.tradition", weight: 0.7 },
    { id: "society.civicLife", weight: 0.3 },
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
  // defense.security is "protection against espionage, subversion, and direct
  // threats", and lists "border control modernisation" as a contributor.
  borderSecurity: [{ id: "defense.security", weight: 1 }],

  // Deliberately unmapped (outcome/monetary, no clean political driver):
  //   governmentApproval (an outcome, not a lever), interestRate, inflationPressure.
};

/** dotted "category.metricId" (optionally ".value") → bare metricId. */
function bareKey(path: string): string {
  const parts = path.split(".");
  const tail = parts[parts.length - 1] === "value" ? parts.slice(0, -1) : parts;
  return tail[tail.length - 1] ?? path;
}

/** Map StateMetrics deltas to political-family contributions (× weight × gain). */
export function mapCabinetDeltasToPolitical(
  deltas: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    const targets = CABINET_KEY_TO_POLITICAL[bareKey(path)];
    if (!targets) continue;
    for (const { id, weight } of targets) {
      out[id] = (out[id] ?? 0) + delta * weight * CABINET_POLITICAL_GAIN;
    }
  }
  return out;
}

/**
 * Map per-region StateMetrics deltas. Regions whose political mapping is empty
 * are omitted so a snapshot does not retain stale site ids.
 */
export function mapRegionalCabinetDeltasToPolitical(
  regionalDeltas: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [regionId, deltas] of Object.entries(regionalDeltas)) {
    const mapped = mapCabinetDeltasToPolitical(deltas);
    if (Object.keys(mapped).length > 0) out[regionId] = mapped;
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

/** One channel's fold: next = clamp(prev·DECAY + contribution, ±cap per source). */
export function foldCabinetResiduals(
  prev: Record<string, number>,
  contribution: Record<string, number>
): Record<string, number> {
  const ids = new Set([...Object.keys(prev), ...Object.keys(contribution)]);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const raw = (prev[id] ?? 0) * CABINET_RESIDUAL_DECAY + (contribution[id] ?? 0);
    const capped = Math.max(
      -CABINET_RESIDUAL_CAP_PER_SOURCE,
      Math.min(CABINET_RESIDUAL_CAP_PER_SOURCE, raw)
    );
    if (Math.abs(capped) >= 0.01) out[id] = +capped.toFixed(4);
  }
  return out;
}

/** Per-source residual state: sourceId → (metricId → points). */
export type CabinetResidualsBySource = Record<string, Record<string, number>>;

/**
 * Reinterpret a pre-#1129 flat residual as per-source state WITHOUT a migration.
 *
 * The stored flat number is a sum whose composition was never recorded, so it
 * cannot be split truthfully. It is split by each source's share of THIS turn's
 * contribution instead, which keeps the applied total identical on the first
 * turn (no player sees a lurch) and is washed out within a few turns by the 0.9
 * decay, after which every channel carries its own true history. Any part of a
 * metric with no current contribution has no share to assign, so it goes to the
 * legacy pen and simply decays.
 */
export function seedBySourceFromLegacy(
  flatPrev: Record<string, number>,
  contributionBySource: Record<string, Record<string, number>>
): CabinetResidualsBySource {
  const out: CabinetResidualsBySource = {};
  const put = (source: string, id: string, v: number) => {
    if (!v) return;
    (out[source] ??= {})[id] = +((out[source][id] ?? 0) + v).toFixed(4);
  };
  for (const [id, prev] of Object.entries(flatPrev)) {
    if (!prev) continue;
    let shareTotal = 0;
    for (const contribution of Object.values(contributionBySource)) {
      shareTotal += Math.abs(contribution[id] ?? 0);
    }
    if (shareTotal <= 0) {
      put(CABINET_LEGACY_SOURCE, id, prev);
      continue;
    }
    for (const [source, contribution] of Object.entries(contributionBySource)) {
      const share = Math.abs(contribution[id] ?? 0) / shareTotal;
      if (share > 0) put(source, id, prev * share);
    }
  }
  return out;
}

/**
 * Fold every channel independently. A channel at its cap can no longer grow,
 * but it cannot stop any OTHER channel from growing either, which is the whole point of
 * ticket #1129. Empty channels are dropped so the stored doc stays small.
 */
export function foldCabinetResidualsBySource(
  prev: CabinetResidualsBySource,
  contributionBySource: Record<string, Record<string, number>>
): CabinetResidualsBySource {
  const sources = new Set([...Object.keys(prev), ...Object.keys(contributionBySource)]);
  const out: CabinetResidualsBySource = {};
  for (const source of sources) {
    const next = foldCabinetResiduals(prev[source] ?? {}, contributionBySource[source] ?? {});
    if (Object.keys(next).length > 0) out[source] = next;
  }
  return out;
}

/** Flatten per-source residuals to the applied total per metric. */
export function sumCabinetResiduals(bySource: CabinetResidualsBySource): Record<string, number> {
  const out: Record<string, number> = {};
  for (const perMetric of Object.values(bySource)) {
    for (const [id, v] of Object.entries(perMetric)) out[id] = (out[id] ?? 0) + v;
  }
  for (const [id, v] of Object.entries(out)) {
    const rounded = +v.toFixed(4);
    if (Math.abs(rounded) < 0.01) delete out[id];
    else out[id] = rounded;
  }
  return out;
}

/**
 * How many channels are pinned at the per-source cap for a metric. The board's
 * at-ceiling warning is only honest when EVERY channel is pinned: below that,
 * building in an unsaturated channel still buys movement.
 */
export function cappedSourceCount(bySource: CabinetResidualsBySource, metricId: string): number {
  let pinned = 0;
  for (const perMetric of Object.values(bySource)) {
    const v = perMetric[metricId] ?? 0;
    if (Math.abs(v) >= CABINET_RESIDUAL_CAP_PER_SOURCE - 0.01) pinned++;
  }
  return pinned;
}
