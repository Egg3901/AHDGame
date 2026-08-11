"use client";

import { describeApprovalEffects } from "@/lib/demographics/effectAudience";
import { DEMOGRAPHIC_GROUPS } from "@/components/admin/lawtype/constants";
import { calculateShiftImpacts } from "@/lib/archetypeAffinities";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { isMetricActive } from "@/lib/era/metricCatalog";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { pushesValueUp } from "@/lib/utils/policyDirection";
import { optionIntensity } from "@/lib/legislature/optionIntensity";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";
import type { MetricCategoryId } from "@/lib/db/types";

// Metric display names for common metrics
const METRIC_NAMES: Record<string, string> = {
  unemploymentRate: "Unemployment",
  medianIncome: "Income",
  gdpGrowth: "GDP Growth",
  povertyRate: "Poverty",
  costOfLiving: "Cost of Living",
  smallBusinessFormation: "Business Formation",
  highSchoolGradRate: "HS Graduation",
  testPerformance: "Test Scores",
  educationSpending: "Ed. Spending",
  literacyRate: "Literacy",
  workforceSkill: "Workforce Skills",
  uninsuredRate: "Uninsured",
  affordabilityIndex: "Healthcare Costs",
  physicianRate: "Physicians",
  lifeExpectancy: "Life Expectancy",
  preventableMortality: "Prev. Mortality",
  publicHealthPreparedness: "Health Readiness",
  roadCondition: "Roads",
  broadbandAccess: "Broadband",
  publicTransit: "Transit",
  waterQuality: "Water Quality",
  powerGridReliability: "Power Grid",
  infrastructureInvestmentGap: "Infra. Gap",
  crimeRate: "Crime",
  violentCrimeRate: "Violent Crime",
  policePerCapita: "Police",
  incarcerationRate: "Incarceration",
  emergencyResponse: "Emergency Response",
  publicSafetyConfidence: "Safety Confidence",
  // P6a axis metrics
  civilLiberties: "Civil Liberties",
  nationalPride: "National Pride",
  militaryReadiness: "Military Readiness",
  stateMediaControl: "State Media Control",
  economicFreedom: "Economic Freedom",
  regulatoryBurden: "Regulatory Burden",
  firearmRights: "Firearm Rights",
  borderSecurity: "Border Security",
  airQuality: "Air Quality",
  renewableEnergy: "Renewables",
  carbonEmissions: "Emissions",
  recyclingRate: "Recycling",
  climateResilience: "Climate Readiness",
  protectedLand: "Protected Land",
  socialMobility: "Social Mobility",
  incomeInequality: "Inequality",
  homelessnessRate: "Homelessness",
  foodInsecurity: "Food Insecurity",
  civicParticipation: "Civic Engagement",
  socialCohesion: "Social Cohesion",
  governmentTransparency: "Transparency",
  budgetBalance: "Budget Balance",
  corruptionIndex: "Corruption",
  voterTurnout: "Voter Turnout",
  publicTrust: "Public Trust",
  nhsWaitingTime: "NHS Waiting",
  childPoverty: "Child Poverty",
  recidivismRate: "Recidivism",
  socialCareQuality: "Social Care",
  mentalHealthAccess: "Mental Health Access",
  universityEnrollment: "Uni. Enrollment",
  gcseAttainment: "GCSE Attainment",
  apprenticeshipRate: "Apprenticeships",
  pressFreedom: "Press Freedom",
  bbcTrust: "BBC Trust",
  devolutionSatisfaction: "Devolution Approval",
  housingAffordability: "Housing Pressure", // pressure index, lower better (P3d)
  migrationRate: "Migration",
  antiSocialBehaviourRate: "Anti-Social Behaviour",
  knifeCrimeRate: "Knife Crime",
};

function ArrowIcon({ direction, major }: { direction: "up" | "down"; major: boolean }) {
  const d = direction === "up" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7";
  const svg = (
    <svg
      className="w-3 h-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
  if (!major) return svg;
  return (
    <span className="inline-flex flex-col -space-y-1.5">
      {svg}
      {svg}
    </span>
  );
}

/**
 * Resolve isHigherBetter from the canonical metric definition.
 * Falls back to `true` (treat unknown metrics as "higher = better") so missing
 * definitions don't silently flip direction.
 */
function resolveIsHigherBetter(categoryId: string, metricId: string): boolean {
  const def = getMetricDefinition(categoryId as MetricCategoryId, metricId);
  return def?.isHigherBetter ?? true;
}

interface EffectTargetWeighted {
  metricCategoryId: string;
  metricId: string;
  weight: number;
}

interface PolicyOptionMetricEffect {
  category: string;
  metricId: string;
  ratePerTurn: number;
}

interface PolicyOptionLite {
  id: string;
  /** Option's left/right intent (+1 left, -1 right, 0 center). Used for delta direction. */
  effectDirection?: number;
  metricEffects?: PolicyOptionMetricEffect[];
  /** Curated economic-axis position (-5 left … +5 right). Feeds the approval direction. */
  economic?: number;
  /** Curated social-axis position (-5 left … +5 right). */
  social?: number;
}

export interface MetricEffectChip {
  name: string;
  direction: "up" | "down";
  isGood: boolean;
  isMajor: boolean;
  /** Metric outside its era window — rendered as "Not tracked in this era". */
  inactive?: boolean;
}

interface ComputeMetricEffectsParams {
  effectTargetsWeighted?: EffectTargetWeighted[];
  effectDirection: number;
  currentPolicyIndex?: number;
  proposedPolicyIndex?: number;
  policyOptions?: PolicyOptionLite[];
  /** Bill country + live era year for the metric existence gate (null = legacy). */
  countryId?: string | null;
  year?: number | null;
}

/**
 * Compute the per-metric projected-effect chips for a proposed policy change.
 *
 * Both paths express a DELTA vs the current law, so the arrows match the
 * bill-detail page ("Projected effects vs current law") and never contradict
 * the metric-detail page:
 *   - Path A: signed delta of each option's `metricEffects.ratePerTurn`
 *     (graded; admin-overridable).
 *   - Path B (fallback): `(proposedOption.effectDirection − currentOption.effectDirection)
 *     × weight`, run through the shared {@link pushesValueUp} polarity helper.
 * Same-side shifts produce a zero delta and are dropped — the runtime scores
 * metric strength from `effectDirection`, so they cause no metric movement.
 */
export function computeMetricEffects({
  effectTargetsWeighted,
  effectDirection,
  currentPolicyIndex,
  proposedPolicyIndex,
  policyOptions,
  countryId,
  year,
}: ComputeMetricEffectsParams): MetricEffectChip[] {
  const chipInactive = (metricId: string): boolean =>
    !isMetricActive(metricId, countryId ?? undefined, year ?? null);
  const metricEffects: MetricEffectChip[] = [];
  const handledMetricKeys = new Set<string>();

  // Path A — shift-based metricEffects delta (proposed.ratePerTurn − current.ratePerTurn).
  if (
    policyOptions?.length &&
    currentPolicyIndex !== undefined &&
    proposedPolicyIndex !== undefined &&
    currentPolicyIndex !== proposedPolicyIndex
  ) {
    const currentOption = policyOptions[currentPolicyIndex];
    const proposedOption = policyOptions[proposedPolicyIndex];
    const proposedEffects = proposedOption?.metricEffects ?? [];
    const currentEffects = currentOption?.metricEffects ?? [];

    const metricKeys = new Map<string, { category: string; metricId: string }>();
    for (const e of [...proposedEffects, ...currentEffects]) {
      metricKeys.set(`${e.category}|${e.metricId}`, { category: e.category, metricId: e.metricId });
    }

    for (const [key, { category, metricId }] of metricKeys) {
      // 📊 budget-sync: computed fiscal metrics are mirror-owned — laws don't move
      // them, so don't advertise a projected effect on them.
      if (MIRROR_CONTROLLED_METRIC_IDS.has(metricId)) continue;
      const proposedRate =
        proposedEffects.find((e) => e.category === category && e.metricId === metricId)
          ?.ratePerTurn ?? 0;
      const currentRate =
        currentEffects.find((e) => e.category === category && e.metricId === metricId)
          ?.ratePerTurn ?? 0;
      const delta = proposedRate - currentRate;
      if (delta === 0) continue;

      const isHigherBetter = resolveIsHigherBetter(category, metricId);
      const goesUp = delta > 0;
      const isGood = goesUp === isHigherBetter;
      // TICK_RATES_7_INV step is 0.02; threshold 0.04 marks a 2+ step shift as major.
      const isMajor = Math.abs(delta) >= 0.04;

      metricEffects.push({
        name: METRIC_NAMES[metricId] || metricId,
        direction: goesUp ? "up" : "down",
        isGood,
        isMajor,
        inactive: chipInactive(metricId),
      });
      handledMetricKeys.add(key);
    }
  }

  // Path B — weighted-target delta. Direction = sign of the change in this
  // option's contribution vs the current law:
  //   (proposedOption.effectDirection − currentOption.effectDirection) × weight,
  // with isHigherBetter polarity applied by pushesValueUp. Used for metrics not
  // covered by Path A (no metricEffects, or leftover targets). When option
  // directions aren't resolvable, currentDir falls back to 0 (center), so this
  // degrades to the proposed option's absolute direction.
  if (effectTargetsWeighted?.length) {
    // Graded option intensity (Bug #0962): a same-side change of intensity
    // (Moderate → Maximum) now yields a non-zero delta, so the chip is shown.
    // Falls back to the effectDirection sign when options/indices are unavailable.
    const proposedIntensity =
      proposedPolicyIndex !== undefined && policyOptions?.length
        ? optionIntensity(policyOptions, proposedPolicyIndex)
        : Math.sign(effectDirection);
    const currentIntensity =
      currentPolicyIndex !== undefined && policyOptions?.length
        ? optionIntensity(policyOptions, currentPolicyIndex)
        : 0;
    const deltaIntensity = proposedIntensity - currentIntensity;

    for (const target of effectTargetsWeighted) {
      const key = `${target.metricCategoryId}|${target.metricId}`;
      if (handledMetricKeys.has(key)) continue;
      // 📊 budget-sync: skip mirror-owned computed fiscal metrics (laws don't move them).
      if (MIRROR_CONTROLLED_METRIC_IDS.has(target.metricId)) continue;

      const weightedDelta = deltaIntensity * target.weight;
      if (weightedDelta === 0) continue;

      const isHigherBetter = resolveIsHigherBetter(target.metricCategoryId, target.metricId);
      const goesUp = pushesValueUp(weightedDelta, isHigherBetter);
      const isGood = goesUp === isHigherBetter;
      // Primary targets are weight 1.0; secondaries usually 0.2-0.5. Treat |weight| >= 0.6 as major.
      const isMajor = Math.abs(target.weight) >= 0.6;

      metricEffects.push({
        name: METRIC_NAMES[target.metricId] || target.metricId,
        direction: goesUp ? "up" : "down",
        isGood,
        isMajor,
        inactive: chipInactive(target.metricId),
      });
      handledMetricKeys.add(key);
    }
  }

  return metricEffects;
}

interface PolicyEffectIndicatorsProps {
  effectTargetsWeighted?: EffectTargetWeighted[];
  effectDirection: number; // -1, 0, or 1
  /** @deprecated Use archetypeApprovals or shift-based props instead */
  groupApprovals?: Record<string, number>;
  /** Per-archetype approval impacts (-100 to +100) - static values */
  archetypeApprovals?: Record<string, number>;
  /** Policy domain for shift-based archetype calculation (e.g., "education") */
  policyDomain?: string;
  /** Current policy index (0-6) for shift-based calculation */
  currentPolicyIndex?: number;
  /** Proposed policy index (0-6) for shift-based calculation */
  proposedPolicyIndex?: number;
  /**
   * Per-option combined position score (`economic + social`), indexed like the option set.
   * Lets the shift-based approval direction follow the curated left-right scores instead of
   * the raw array index — required for right→left-ordered option sets (all tax brackets,
   * some CN/DE/JP types). When omitted, derived from `policyOptions` if those carry scores.
   */
  policyOptionScores?: number[];
  /** Country whose archetype affinity table to use (UK, JP). Omit for US (default). */
  billCountry?: string;
  /**
   * Full ordered list of the legislation type's options. When provided alongside
   * current/proposed indices, the metric arrows show the per-turn delta between
   * current and proposed options' metricEffects (e.g. proposing a slightly less
   * generous welfare option while the maximum is active will show ↑ poverty).
   * Without this prop, metric arrows fall back to absolute direction from
   * effectTargetsWeighted (post-isHigherBetter correction).
   */
  policyOptions?: PolicyOptionLite[];
}

export function PolicyEffectIndicators({
  effectTargetsWeighted,
  effectDirection,
  groupApprovals,
  archetypeApprovals,
  policyDomain,
  currentPolicyIndex,
  proposedPolicyIndex,
  billCountry,
  policyOptions,
  policyOptionScores,
}: PolicyEffectIndicatorsProps) {
  // Era flags — read before any early return (rules of hooks).
  const { eraSystemEnabled, currentYear } = useWorldFlags();
  // Calculate shift-based approvals if we have the necessary data
  // This takes priority over static archetypeApprovals
  let approvals: Record<string, number> | undefined;

  if (policyDomain && currentPolicyIndex !== undefined && proposedPolicyIndex !== undefined) {
    // Use shift-based calculation; billCountry selects UK/JP archetype tables
    // (falls back to US DOMAIN_AFFINITIES when undefined). Pass the curated per-option
    // position scores so the shift direction is correct even for right→left-ordered
    // option sets (all tax brackets, some CN/DE/JP types) — without them the bare index
    // runs opposite the affinity convention and flips every approval sign.
    const optionScores =
      policyOptionScores ?? policyOptions?.map((o) => (o.economic ?? 0) + (o.social ?? 0));
    approvals = calculateShiftImpacts(
      policyDomain,
      currentPolicyIndex,
      proposedPolicyIndex,
      billCountry,
      optionScores
    );
  } else {
    // Fall back to static approvals (or deprecated groupApprovals)
    approvals = archetypeApprovals ?? groupApprovals;
  }

  const hasApprovals = approvals && Object.keys(approvals).length > 0;
  if (!effectTargetsWeighted?.length && !hasApprovals && !policyOptions?.length) {
    return null;
  }

  // Compute metric effects (delta vs current law — see computeMetricEffects).
  const metricEffects = computeMetricEffects({
    effectTargetsWeighted,
    effectDirection,
    currentPolicyIndex,
    proposedPolicyIndex,
    policyOptions,
    countryId: billCountry,
    year: eraSystemEnabled ? currentYear : null,
  });

  // Compute archetype approvals
  // Track magnitude to determine major (double arrow) vs minor (single arrow)
  const archetypeEffects: {
    name: string;
    direction: "up" | "down";
    isGood: boolean;
    isMajor: boolean;
  }[] = [];

  if (hasApprovals) {
    // Described in Layer-1 buckets where the projection lands in the country's
    // own electorate model, and in archetypes where it does not — see
    // `describeApprovalEffects`. Naming a group the player's world does not have
    // would be worse than the archetype label it replaced.
    for (const row of describeApprovalEffects(
      approvals!,
      billCountry,
      (id) => DEMOGRAPHIC_GROUPS.find((g) => g.id === id)?.name || id
    )) {
      archetypeEffects.push({
        name: row.label,
        direction: row.value > 0 ? "up" : "down",
        isGood: row.value > 0,
        isMajor: Math.abs(row.value) >= 5, // Major impact threshold (scale is ±10 max)
      });
    }
  }

  if (metricEffects.length === 0 && archetypeEffects.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 pt-2 border-t border-card-border/30 space-y-2">
      {/* Metric Effects */}
      {metricEffects.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted/70 w-full mb-0.5">
            Metric Effects
          </span>
          {metricEffects.map(({ name, direction, isGood, isMajor, inactive }) =>
            inactive ? (
              <span
                key={name}
                className="inline-flex items-center gap-0.5 text-xs text-muted/60 line-through"
                title="Not tracked in this era"
              >
                {name} — Not tracked in this era
              </span>
            ) : (
              <span
                key={name}
                className={`inline-flex items-center gap-0.5 text-xs ${
                  isGood ? "text-success" : "text-error"
                }`}
              >
                <ArrowIcon direction={direction} major={isMajor} />
                {name}
              </span>
            )
          )}
        </div>
      )}

      {/* Archetype Approvals */}
      {archetypeEffects.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted/70 w-full mb-0.5">
            Archetype Approvals
          </span>
          {archetypeEffects.map(({ name, direction, isGood, isMajor }) => (
            <span
              key={name}
              className={`inline-flex items-center gap-0.5 text-xs ${
                isGood ? "text-success" : "text-error"
              }`}
            >
              <ArrowIcon direction={direction} major={isMajor} />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
