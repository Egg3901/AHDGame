import {
  getBroadbandMarginModifier,
  getCarbonEmissionsMarginModifier,
  getCorruptionMarginModifier,
  getCostOfLivingMarginModifier,
  getCrimeRateMarginModifier,
  getGridReliabilityMarginModifier,
  getRoadConditionMarginModifier,
  getUnemploymentMarginModifier,
  getWorkforceSkillMarginModifier,
  WORKFORCE_SKILL_SECTORS,
  CRIME_RATE_SECTORS,
  BROADBAND_SECTORS,
  ROAD_CONDITION_SECTORS,
  CARBON_EMISSIONS_SECTORS,
  COST_OF_LIVING_SECTORS,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { metricCategories, type MetricDefinition } from "@/lib/constants/metricDefinitions";
import { getEraBand, isMetricActive } from "@/lib/era/metricCatalog";
import { toUsd } from "@/lib/utils/fxNormalize";
import { THRESHOLDS } from "@/lib/utils/metricScoring";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { MetricCategoryId, StateMetrics } from "@/lib/db/types";
import type {
  SectorMetricMarginChannel,
  StateMetricMarginContribution,
  StateMetricMarginInput,
  StateMetricMarginResult,
} from "./stateMetricMarginTypes";
import { METRIC_MARGIN_SIGNALS } from "./sectorMetricMarginSignals";
import type { ChannelWeights, MetricMarginSignal } from "./sectorMetricMarginSignals";

export const STATE_METRIC_PER_METRIC_CAP = 0.75;
export const STATE_METRIC_PER_CHANNEL_CAP = 2;
export const STATE_METRIC_TOTAL_CAP = 8;

export const SECTOR_METRIC_MARGIN_CHANNELS: readonly SectorMetricMarginChannel[] = [
  "laborCost",
  "laborQuality",
  "consumerDemand",
  "physicalLogistics",
  "digitalInfrastructure",
  "gridReliability",
  "publicSafety",
  "regulatoryTrust",
  "environmentalCompliance",
  "healthCapacity",
  "housingLandUse",
  "innovation",
  "mediaTrust",
  "demographics",
  "publicProcurement",
] as const;

interface PreparedContribution extends StateMetricMarginContribution {
  metricKey: string;
}

const ZERO_PROFILE: Record<SectorMetricMarginChannel, number> =
  SECTOR_METRIC_MARGIN_CHANNELS.reduce(
    (acc, channel) => {
      acc[channel] = 0;
      return acc;
    },
    {} as Record<SectorMetricMarginChannel, number>
  );

const COMMON_PROFILE: ChannelWeights = {
  laborCost: 0.55,
  laborQuality: 0.35,
  consumerDemand: 0.35,
  physicalLogistics: 0.35,
  digitalInfrastructure: 0.25,
  gridReliability: 0.35,
  publicSafety: 0.2,
  regulatoryTrust: 0.25,
  environmentalCompliance: 0.2,
  healthCapacity: 0.15,
  housingLandUse: 0.15,
  innovation: 0.2,
  mediaTrust: 0.15,
  demographics: 0.25,
  publicProcurement: 0.12,
};

const SECTOR_CHANNEL_PROFILES: Record<CorporationType, ChannelWeights> = {
  financial: {
    ...COMMON_PROFILE,
    laborQuality: 0.75,
    consumerDemand: 0.55,
    digitalInfrastructure: 0.85,
    regulatoryTrust: 0.8,
    mediaTrust: 0.55,
    innovation: 0.55,
  },
  media: {
    ...COMMON_PROFILE,
    laborQuality: 0.6,
    consumerDemand: 0.55,
    digitalInfrastructure: 0.75,
    publicSafety: 0.12,
    regulatoryTrust: 0.55,
    innovation: 0.45,
    mediaTrust: 0.95,
  },
  manufacturing: {
    ...COMMON_PROFILE,
    laborCost: 0.9,
    laborQuality: 0.85,
    physicalLogistics: 0.9,
    gridReliability: 0.9,
    environmentalCompliance: 0.75,
    innovation: 0.45,
  },
  chemical_industries: {
    ...COMMON_PROFILE,
    laborQuality: 0.85,
    physicalLogistics: 0.7,
    gridReliability: 0.85,
    regulatoryTrust: 0.7,
    environmentalCompliance: 1,
    healthCapacity: 0.4,
    innovation: 0.65,
  },
  healthcare: {
    ...COMMON_PROFILE,
    laborQuality: 1,
    consumerDemand: 0.45,
    digitalInfrastructure: 0.45,
    regulatoryTrust: 0.75,
    healthCapacity: 1,
    demographics: 0.75,
    publicProcurement: 0.55,
  },
  retail: {
    ...COMMON_PROFILE,
    laborCost: 0.75,
    consumerDemand: 0.85,
    physicalLogistics: 0.7,
    digitalInfrastructure: 0.45,
    publicSafety: 0.75,
    mediaTrust: 0.35,
    demographics: 0.6,
  },
  automobiles: {
    ...COMMON_PROFILE,
    laborCost: 0.75,
    laborQuality: 0.8,
    consumerDemand: 0.6,
    physicalLogistics: 0.9,
    gridReliability: 0.85,
    environmentalCompliance: 0.9,
    innovation: 0.65,
  },
  technology: {
    ...COMMON_PROFILE,
    laborQuality: 1,
    digitalInfrastructure: 1,
    gridReliability: 0.75,
    regulatoryTrust: 0.45,
    innovation: 1,
    mediaTrust: 0.35,
  },
  energy: {
    ...COMMON_PROFILE,
    laborQuality: 0.65,
    physicalLogistics: 0.75,
    gridReliability: 1,
    regulatoryTrust: 0.65,
    environmentalCompliance: 1,
    publicProcurement: 0.4,
  },
  agriculture: {
    ...COMMON_PROFILE,
    laborCost: 0.75,
    physicalLogistics: 0.85,
    gridReliability: 0.45,
    environmentalCompliance: 0.85,
    demographics: 0.55,
    publicProcurement: 0.25,
  },
  real_estate: {
    ...COMMON_PROFILE,
    laborCost: 0.35,
    consumerDemand: 0.9,
    physicalLogistics: 0.45,
    publicSafety: 0.85,
    regulatoryTrust: 0.6,
    housingLandUse: 1,
    demographics: 0.8,
  },
  construction: {
    ...COMMON_PROFILE,
    laborCost: 0.8,
    laborQuality: 0.65,
    consumerDemand: 0.5,
    physicalLogistics: 1,
    gridReliability: 0.45,
    regulatoryTrust: 0.55,
    housingLandUse: 0.85,
    publicProcurement: 0.7,
  },
  defense: {
    ...COMMON_PROFILE,
    laborQuality: 0.95,
    physicalLogistics: 0.65,
    digitalInfrastructure: 0.65,
    gridReliability: 0.75,
    regulatoryTrust: 0.8,
    innovation: 0.85,
    publicProcurement: 1,
  },
  telecommunications: {
    ...COMMON_PROFILE,
    laborQuality: 0.75,
    physicalLogistics: 0.55,
    digitalInfrastructure: 1,
    gridReliability: 1,
    regulatoryTrust: 0.65,
    innovation: 0.75,
    publicProcurement: 0.35,
  },
  entertainment: {
    ...COMMON_PROFILE,
    laborCost: 0.55,
    consumerDemand: 0.85,
    digitalInfrastructure: 0.55,
    publicSafety: 0.65,
    mediaTrust: 0.8,
    demographics: 0.6,
  },
  logistics: {
    ...COMMON_PROFILE,
    laborCost: 0.65,
    laborQuality: 0.55,
    consumerDemand: 0.35,
    physicalLogistics: 1,
    digitalInfrastructure: 0.65,
    gridReliability: 0.55,
    publicSafety: 0.35,
    innovation: 0.55,
  },
  extraction: {
    ...COMMON_PROFILE,
    laborCost: 0.6,
    laborQuality: 0.55,
    physicalLogistics: 1,
    gridReliability: 0.8,
    regulatoryTrust: 0.65,
    environmentalCompliance: 1,
    housingLandUse: 0.35,
    publicProcurement: 0.25,
  },
};

const STRATEGY_CHANNEL_OVERRIDES: Record<string, ChannelWeights> = {
  "retail.ecommerce": {
    consumerDemand: 0.75,
    physicalLogistics: 0.8,
    digitalInfrastructure: 1,
    publicSafety: 0.2,
    mediaTrust: 0.55,
    innovation: 0.5,
  },
  "retail.brick_mortar": {
    laborCost: 0.85,
    consumerDemand: 0.95,
    physicalLogistics: 0.55,
    digitalInfrastructure: 0.18,
    publicSafety: 1,
    housingLandUse: 0.45,
  },
  "technology.software": {
    laborCost: 0.45,
    laborQuality: 1.1,
    digitalInfrastructure: 1.1,
    gridReliability: 0.75,
    innovation: 1.1,
    mediaTrust: 0.55,
    physicalLogistics: 0.15,
  },
  "technology.hardware": {
    laborCost: 0.75,
    laborQuality: 1,
    physicalLogistics: 0.85,
    digitalInfrastructure: 0.75,
    gridReliability: 1.05,
    environmentalCompliance: 0.7,
    innovation: 0.85,
  },
  "energy.renewables": {
    environmentalCompliance: 1.15,
    gridReliability: 1.1,
    physicalLogistics: 0.8,
    innovation: 0.75,
    publicProcurement: 0.55,
  },
  "energy.nuclear": {
    environmentalCompliance: 1.05,
    gridReliability: 1.15,
    regulatoryTrust: 0.95,
    publicSafety: 0.45,
    publicProcurement: 0.65,
    mediaTrust: 0.45,
  },
  "manufacturing.heavy_metals": {
    physicalLogistics: 1,
    gridReliability: 1,
    environmentalCompliance: 1.05,
    laborQuality: 0.75,
  },
  "manufacturing.electronics_manufacturing": {
    laborQuality: 1,
    digitalInfrastructure: 0.75,
    gridReliability: 1,
    innovation: 0.85,
  },
  "agriculture.industrial": {
    laborCost: 0.85,
    physicalLogistics: 0.95,
    gridReliability: 0.6,
    environmentalCompliance: 0.75,
  },
  "agriculture.sustainable": {
    environmentalCompliance: 1.05,
    consumerDemand: 0.55,
    mediaTrust: 0.35,
    publicProcurement: 0.35,
  },
  "chemical_industries.fertilizers": {
    physicalLogistics: 0.8,
    gridReliability: 0.9,
    environmentalCompliance: 0.95,
    publicProcurement: 0.35,
  },
  "chemical_industries.pharmaceuticals": {
    laborQuality: 1,
    healthCapacity: 0.85,
    regulatoryTrust: 0.85,
    innovation: 1,
    environmentalCompliance: 0.7,
  },
  "chemical_industries.plastics": {
    physicalLogistics: 0.85,
    gridReliability: 0.85,
    environmentalCompliance: 1.05,
    consumerDemand: 0.4,
  },
  "healthcare.biotech": {
    laborQuality: 1.1,
    digitalInfrastructure: 0.65,
    healthCapacity: 0.9,
    innovation: 1.1,
    publicProcurement: 0.4,
  },
  "healthcare.pharma_mass": {
    laborQuality: 0.9,
    physicalLogistics: 0.65,
    gridReliability: 0.7,
    healthCapacity: 0.8,
    publicProcurement: 0.65,
  },
  "automobiles.ev": {
    digitalInfrastructure: 0.55,
    gridReliability: 1,
    environmentalCompliance: 1.05,
    innovation: 0.95,
  },
  "automobiles.heavy_machinery": {
    physicalLogistics: 1,
    gridReliability: 0.9,
    publicProcurement: 0.55,
    consumerDemand: 0.4,
  },
  "financial.fintech": {
    laborQuality: 0.95,
    digitalInfrastructure: 1.1,
    regulatoryTrust: 0.8,
    innovation: 1,
    mediaTrust: 0.45,
  },
  "financial.traditional_banking": {
    consumerDemand: 0.6,
    regulatoryTrust: 1,
    mediaTrust: 0.65,
    digitalInfrastructure: 0.65,
  },
  "media.digital_first": {
    digitalInfrastructure: 1,
    mediaTrust: 1,
    innovation: 0.65,
    consumerDemand: 0.65,
  },
  "media.legacy_broadcast": {
    mediaTrust: 1,
    regulatoryTrust: 0.75,
    demographics: 0.65,
    digitalInfrastructure: 0.45,
  },
  "defense.cyber": {
    laborQuality: 1.1,
    digitalInfrastructure: 1.05,
    gridReliability: 0.95,
    innovation: 1.1,
    publicProcurement: 0.95,
  },
  "defense.heavy_armor": {
    physicalLogistics: 0.9,
    gridReliability: 0.9,
    laborQuality: 0.75,
    publicProcurement: 1,
  },
  "defense.munitions": {
    physicalLogistics: 0.85,
    gridReliability: 0.9,
    regulatoryTrust: 0.9,
    environmentalCompliance: 0.85,
    publicProcurement: 1,
  },
  "real_estate.commercial": {
    consumerDemand: 1,
    publicSafety: 0.8,
    housingLandUse: 1,
    demographics: 0.75,
  },
  "real_estate.green_building": {
    environmentalCompliance: 0.9,
    housingLandUse: 0.9,
    consumerDemand: 0.8,
    regulatoryTrust: 0.65,
  },
  "construction.infrastructure": {
    physicalLogistics: 1.05,
    gridReliability: 0.6,
    publicProcurement: 1,
    regulatoryTrust: 0.7,
  },
  "construction.modular": {
    laborQuality: 0.75,
    physicalLogistics: 0.85,
    innovation: 0.75,
    housingLandUse: 0.7,
  },
  "telecommunications.infrastructure": {
    physicalLogistics: 0.7,
    digitalInfrastructure: 1.05,
    gridReliability: 1.1,
    publicProcurement: 0.6,
  },
  "telecommunications.cloud": {
    laborQuality: 0.85,
    digitalInfrastructure: 1.1,
    gridReliability: 1.15,
    innovation: 0.9,
  },
  "entertainment.streaming": {
    digitalInfrastructure: 1,
    consumerDemand: 0.8,
    mediaTrust: 0.95,
    publicSafety: 0.15,
  },
  "entertainment.live_venue": {
    consumerDemand: 0.95,
    publicSafety: 0.9,
    physicalLogistics: 0.55,
    mediaTrust: 0.65,
  },
  "logistics.automated": {
    laborCost: 0.45,
    laborQuality: 0.75,
    physicalLogistics: 1,
    digitalInfrastructure: 0.9,
    innovation: 0.9,
  },
  "logistics.full_service": {
    laborCost: 0.8,
    physicalLogistics: 1.05,
    publicSafety: 0.45,
    consumerDemand: 0.45,
  },
  "extraction.iron_mining": {
    physicalLogistics: 1.05,
    gridReliability: 0.85,
    environmentalCompliance: 0.95,
  },
  "extraction.oil_gas": {
    physicalLogistics: 0.95,
    gridReliability: 0.95,
    regulatoryTrust: 0.8,
    environmentalCompliance: 1.15,
    mediaTrust: 0.35,
  },
  "extraction.rare_earth_mining": {
    laborQuality: 0.75,
    physicalLogistics: 0.9,
    gridReliability: 0.85,
    environmentalCompliance: 1,
    publicProcurement: 0.45,
  },
  "extraction.coal_mining": {
    physicalLogistics: 0.95,
    gridReliability: 0.8,
    environmentalCompliance: 1.2,
    mediaTrust: 0.35,
  },
  "extraction.timber_logging": {
    physicalLogistics: 1,
    environmentalCompliance: 1,
    housingLandUse: 0.5,
  },
};

// METRIC_MARGIN_SIGNALS moved to sectorMetricMarginSignals.ts (size cap);
// re-exported here so existing import paths keep working.
export { METRIC_MARGIN_SIGNALS };

const SIGNAL_BY_KEY = new Map(
  METRIC_MARGIN_SIGNALS.map((s) => [metricKey(s.category, s.metricId), s])
);

const HEADLINE_METRIC_MAP: Record<string, keyof StateMetricMarginResult["headlineModifiers"]> = {
  "economic.unemploymentRate": "unemploymentModifier",
  "infrastructure.powerGridReliability": "gridReliabilityModifier",
  "governance.corruptionIndex": "corruptionModifier",
  "education.workforceSkill": "workforceSkillModifier",
  "publicSafety.crimeRate": "crimeRateModifier",
  "infrastructure.broadbandAccess": "broadbandModifier",
  "infrastructure.roadCondition": "roadConditionModifier",
  "environment.carbonEmissions": "carbonEmissionsModifier",
  "economic.costOfLiving": "costOfLivingModifier",
};

export function metricKey(category: MetricCategoryId, metricId: string): string {
  return `${category}.${metricId}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function mergeProfile(
  ...profiles: Array<ChannelWeights | undefined>
): Record<SectorMetricMarginChannel, number> {
  const merged = { ...ZERO_PROFILE };
  for (const profile of profiles) {
    if (!profile) continue;
    for (const channel of SECTOR_METRIC_MARGIN_CHANNELS) {
      const value = profile[channel];
      if (value != null) merged[channel] = value;
    }
  }
  return merged;
}

export function getStrategyMetricMarginProfile(
  sectorType: CorporationType,
  strategyId: string | null | undefined
): Record<SectorMetricMarginChannel, number> {
  const normalizedStrategy = strategyId ?? "standard";
  const strategyExists = SECTOR_STRATEGIES[sectorType]?.some((s) => s.id === normalizedStrategy);
  const profileKey = `${sectorType}.${strategyExists ? normalizedStrategy : "standard"}`;
  return mergeProfile(SECTOR_CHANNEL_PROFILES[sectorType], STRATEGY_CHANNEL_OVERRIDES[profileKey]);
}

export function getBlendedStrategyMetricMarginProfile(
  sectorType: CorporationType,
  strategyId: string | null | undefined,
  transitionFromStrategyId?: string | null,
  transitionProgress?: number | null
): Record<SectorMetricMarginChannel, number> {
  const target = getStrategyMetricMarginProfile(sectorType, strategyId);
  if (!transitionFromStrategyId || transitionProgress == null) return target;

  const source = getStrategyMetricMarginProfile(sectorType, transitionFromStrategyId);
  const progress = clamp(transitionProgress, 0, 1);
  const blended = { ...ZERO_PROFILE };
  for (const channel of SECTOR_METRIC_MARGIN_CHANNELS) {
    blended[channel] = source[channel] * (1 - progress) + target[channel] * progress;
  }
  return blended;
}

function valueForMetric(
  stateMetrics: StateMetrics,
  category: MetricCategoryId,
  metricId: string
): number | null {
  const categoryDoc = stateMetrics[category] as
    | Record<string, { value?: number | null } | undefined>
    | undefined;
  const value = categoryDoc?.[metricId]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Exported for the non-playable political-board derivation (spec step 4),
 * which inverts legacy stateMetrics values into 0-100 family scores. Kept here
 * rather than moved so the corp margin path — its original and hottest caller —
 * keeps its local definition and there is one normalization behavior.
 */
/**
 * The REALISTIC operating range a metric's quality is normalized over.
 *
 * THRESHOLDS encodes best/worst (the realistic span) — that is what a quality
 * signal wants. `minValue`/`maxValue` are clamp guards (S1 widened several to
 * headroom ceilings, e.g. educationSpending [0, 10M]), so using them here would
 * pin every realistic value to an extreme. Direction is NOT applied here; the
 * `isHigherBetter` flip happens at the caller, so best/worst are simply ordered
 * into [min, max].
 *
 * Exported because the INVERSE (legacyValueFromPoliticalScore) has to normalize
 * over the identical range or the round trip drifts. One definition, two
 * directions — never re-derive this span locally.
 */
export function metricQualityRange(
  definition: MetricDefinition,
  metricId: string,
  era?: { countryId?: string | null; year?: number | null }
): { min: number; max: number } {
  // ERA-AWARE, OPT-IN. A metric's realistic span moves with the era: Japan's
  // 1953 life-expectancy band is 54-69 against a modern 70-85, so a real 1953
  // value of 62 is mid-range for its time but pins to the FLOOR against modern
  // thresholds. Passing a year uses the era band where one is authored.
  //
  // Opt-in on purpose: the corp-margin path calls this every turn with no era,
  // and silently re-basing those margins would change live economics. Callers
  // that mean "how good is this FOR ITS TIME" pass a year; everyone else keeps
  // the modern thresholds byte-for-byte.
  if (era?.year != null) {
    const band = getEraBand(metricId, era.countryId ?? undefined, era.year);
    if (band) {
      return {
        min: Math.min(band.best, band.worst),
        max: Math.max(band.best, band.worst),
      };
    }
  }
  const threshold = THRESHOLDS[metricId];
  if (threshold) {
    return {
      min: Math.min(threshold.best, threshold.worst),
      max: Math.max(threshold.best, threshold.worst),
    };
  }
  const fallbackRange =
    definition.unit === "years"
      ? [70, 85]
      : definition.unit === "rate" && !definition.maxValue
        ? [0, 100]
        : [0, 100];
  return {
    min: definition.minValue ?? fallbackRange[0],
    max: definition.maxValue ?? fallbackRange[1],
  };
}

export function normalizedMetricQuality(
  value: number,
  definition: MetricDefinition,
  metricId: string,
  countryId?: string | null,
  /** Opt-in era: score against the metric's band FOR THAT YEAR (see metricQualityRange). */
  year?: number | null
): number {
  if (metricId === "medianIncome") {
    // Normalize to USD so all countries score against the same thresholds
    const usdValue = toUsd(value, countryId ?? "");
    const low = 5_000;
    const high = 90_000;
    const normalized =
      (Math.log(Math.max(1, usdValue)) - Math.log(low)) / (Math.log(high) - Math.log(low));
    return clamp(normalized * 2 - 1, -1, 1);
  }

  const { min, max } = metricQualityRange(definition, metricId, { countryId, year });
  if (max <= min) return 0;
  const normalized = clamp((value - min) / (max - min), 0, 1);
  const quality = definition.isHigherBetter ? normalized * 2 - 1 : (1 - normalized) * 2 - 1;
  return clamp(quality, -1, 1);
}

function metricBaseModifier(
  signal: MetricMarginSignal,
  value: number,
  definition: MetricDefinition,
  countryId?: string | null
): number {
  if (signal.legacyFormula) return signal.legacyFormula(value);
  return (
    normalizedMetricQuality(value, definition, signal.metricId, countryId) *
    STATE_METRIC_PER_METRIC_CAP
  );
}

function applyGroupedCap(
  contributions: PreparedContribution[],
  cap: number,
  keyFor: (contribution: PreparedContribution) => string
): PreparedContribution[] {
  const totals = new Map<string, number>();
  for (const contribution of contributions) {
    const key = keyFor(contribution);
    totals.set(key, (totals.get(key) ?? 0) + contribution.modifier);
  }

  const scaleByKey = new Map<string, number>();
  for (const [key, total] of totals) {
    scaleByKey.set(key, Math.abs(total) > cap ? cap / Math.abs(total) : 1);
  }

  return contributions.map((contribution) => ({
    ...contribution,
    modifier: contribution.modifier * (scaleByKey.get(keyFor(contribution)) ?? 1),
  }));
}

function applyTotalCap(contributions: PreparedContribution[]): PreparedContribution[] {
  const total = contributions.reduce((sum, contribution) => sum + contribution.modifier, 0);
  if (Math.abs(total) <= STATE_METRIC_TOTAL_CAP) return contributions;
  const scale = STATE_METRIC_TOTAL_CAP / Math.abs(total);
  return contributions.map((contribution) => ({
    ...contribution,
    modifier: contribution.modifier * scale,
  }));
}

function buildHeadlineModifiers(
  contributions: PreparedContribution[]
): StateMetricMarginResult["headlineModifiers"] {
  const headline: StateMetricMarginResult["headlineModifiers"] = {
    workforceSkillModifier: null,
    crimeRateModifier: null,
    broadbandModifier: null,
    roadConditionModifier: null,
    carbonEmissionsModifier: null,
    costOfLivingModifier: null,
  };

  for (const contribution of contributions) {
    const field = HEADLINE_METRIC_MAP[contribution.metricKey];
    if (!field) continue;
    const current = headline[field];
    headline[field] = round((typeof current === "number" ? current : 0) + contribution.modifier);
  }

  headline.unemploymentModifier ??= 0;
  headline.gridReliabilityModifier ??= 0;
  headline.corruptionModifier ??= 0;
  return headline;
}

function legacyStateMetricTotal(
  sectorType: CorporationType,
  stateMetrics?: StateMetrics | null
): number {
  if (!stateMetrics) return 0;
  const unemployment = getUnemploymentMarginModifier(
    stateMetrics.economic?.unemploymentRate?.value
  );
  const grid = getGridReliabilityMarginModifier(
    stateMetrics.infrastructure?.powerGridReliability?.value
  );
  const corruption = getCorruptionMarginModifier(stateMetrics.governance?.corruptionIndex?.value);
  const workforce = WORKFORCE_SKILL_SECTORS.has(sectorType)
    ? getWorkforceSkillMarginModifier(stateMetrics.education?.workforceSkill?.value)
    : 0;
  const crime = CRIME_RATE_SECTORS.has(sectorType)
    ? getCrimeRateMarginModifier(stateMetrics.publicSafety?.crimeRate?.value)
    : 0;
  const broadband = BROADBAND_SECTORS.has(sectorType)
    ? getBroadbandMarginModifier(stateMetrics.infrastructure?.broadbandAccess?.value)
    : 0;
  const roads = ROAD_CONDITION_SECTORS.has(sectorType)
    ? getRoadConditionMarginModifier(stateMetrics.infrastructure?.roadCondition?.value)
    : 0;
  const carbon = CARBON_EMISSIONS_SECTORS.has(sectorType)
    ? getCarbonEmissionsMarginModifier(stateMetrics.environment?.carbonEmissions?.value)
    : 0;
  const costOfLiving = COST_OF_LIVING_SECTORS.has(sectorType)
    ? getCostOfLivingMarginModifier(stateMetrics.economic?.costOfLiving?.value)
    : 0;
  return (
    unemployment + grid + corruption + workforce + crime + broadband + roads + carbon + costOfLiving
  );
}

export function computeStateMetricMarginModifier(
  input: StateMetricMarginInput
): StateMetricMarginResult {
  const profile = getBlendedStrategyMetricMarginProfile(
    input.sectorType,
    input.strategyId,
    input.transitionFromStrategyId,
    input.transitionProgress
  );
  const prepared: PreparedContribution[] = [];
  const legacyTotal = legacyStateMetricTotal(input.sectorType, input.stateMetrics);

  if (input.stateMetrics) {
    for (const category of metricCategories) {
      for (const definition of category.metrics) {
        const signal = SIGNAL_BY_KEY.get(metricKey(category.id, definition.id));
        if (!signal || Object.keys(signal.channels).length === 0) continue;
        // Era existence gate: metrics outside their era window contribute no
        // margin signal (year null = flag off = everything active).
        if (
          !isMetricActive(
            definition.id,
            input.countryId ?? input.stateMetrics.countryId ?? undefined,
            input.year ?? null
          )
        ) {
          continue;
        }
        const storedValue = valueForMetric(input.stateMetrics, category.id, definition.id);
        // SP4 §4a: a playable region's demolished political signal resolves
        // from the adapter overlay; a stored value (survivor metrics, and every
        // non-playable region) always wins so the legacy path is untouched.
        const overlay =
          storedValue == null
            ? input.politicalBaseModifiers?.get(metricKey(category.id, definition.id))
            : undefined;
        if (storedValue == null && overlay == null) continue;
        const rawValue = storedValue ?? overlay!.rawValue;

        const baseModifier =
          storedValue != null
            ? metricBaseModifier(
                signal,
                storedValue,
                definition,
                input.countryId ?? input.stateMetrics.countryId
              )
            : overlay!.modifier;
        if (baseModifier === 0) continue;

        for (const [channel, channelWeight] of Object.entries(signal.channels) as Array<
          [SectorMetricMarginChannel, number]
        >) {
          const strategyWeight = profile[channel] ?? 0;
          if (strategyWeight === 0 || channelWeight === 0) continue;
          prepared.push({
            metricKey: metricKey(category.id, definition.id),
            category: category.id,
            metricId: definition.id,
            label: definition.shortName ?? definition.name,
            rawValue,
            modifier: baseModifier * channelWeight * strategyWeight,
            channel,
            rationale: signal.rationale,
          });
        }
      }
    }
  }

  const metricCapped = applyGroupedCap(prepared, STATE_METRIC_PER_METRIC_CAP, (c) => c.metricKey);
  const total = metricCapped.reduce((sum, contribution) => sum + contribution.modifier, 0);
  const channelCapped = applyGroupedCap(
    metricCapped,
    STATE_METRIC_PER_CHANNEL_CAP,
    (c) => c.channel
  );
  const totalCapped = applyTotalCap(channelCapped);
  const cappedTotal = round(
    clamp(
      totalCapped.reduce((sum, contribution) => sum + contribution.modifier, 0),
      -STATE_METRIC_TOTAL_CAP,
      STATE_METRIC_TOTAL_CAP
    )
  );
  const capped = totalCapped.map((contribution) => ({
    ...contribution,
    modifier: round(contribution.modifier),
  }));

  return {
    total: round(total),
    cappedTotal,
    legacyTotal: round(legacyTotal),
    contributions: capped
      .filter((contribution) => contribution.modifier !== 0)
      .sort((a, b) => Math.abs(b.modifier) - Math.abs(a.modifier)),
    headlineModifiers: buildHeadlineModifiers(capped),
  };
}

export function getMetricStrategyCoverage(
  sectorType: CorporationType,
  strategyId: string,
  category: MetricCategoryId,
  metricId: string
): { effect: boolean; rationale: string } {
  const signal = SIGNAL_BY_KEY.get(metricKey(category, metricId));
  if (!signal || Object.keys(signal.channels).length === 0) {
    return {
      effect: false,
      rationale:
        signal?.neutralRationale ??
        "This metric is intentionally neutral for sector margins and is handled by another system.",
    };
  }

  const profile = getStrategyMetricMarginProfile(sectorType, strategyId);
  const activeChannels = Object.keys(signal.channels).filter(
    (channel) => profile[channel as SectorMetricMarginChannel] !== 0
  );
  if (activeChannels.length > 0) return { effect: true, rationale: signal.rationale };

  return {
    effect: false,
    rationale: `This strategy does not materially depend on ${Object.keys(signal.channels).join(", ")}.`,
  };
}

export function getNeutralMetricMappings(): Array<{
  category: MetricCategoryId;
  metricId: string;
  rationale: string;
}> {
  return METRIC_MARGIN_SIGNALS.filter((signal) => Object.keys(signal.channels).length === 0).map(
    (signal) => ({
      category: signal.category,
      metricId: signal.metricId,
      rationale: signal.neutralRationale ?? signal.rationale,
    })
  );
}
