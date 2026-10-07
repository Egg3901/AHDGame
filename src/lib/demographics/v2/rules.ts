/**
 * Portable Demographics v2 rules. Plain data in, plain data out.
 *
 * The shell owns database reads and candidate enrichment. This module only
 * reconciles the live population stock with the electorate and resolves the
 * explainable participation and issue-salience layers.
 */

import { DEFAULT_DEMOGRAPHICS_V2_CALIBRATION, type DemographicsV2Calibration } from "./calibration";

export interface AgeSexVectorInput {
  male: readonly number[];
  female: readonly number[];
}

export interface ParticipationContext {
  baselineTurnout: number;
  salience: number;
  competitiveness: number;
  accessFriction: number;
  contactLift?: number;
  saturation?: number;
}

export interface ParticipationLedger {
  baseline: number;
  salience: number;
  competitiveness: number;
  access: number;
  contact: number;
  saturation: number;
  resolvedTurnout: number;
}

export interface ParticipationSummary extends ParticipationLedger {
  calibrationId: string;
  economicSalience: number;
  socialSalience: number;
  competitivenessScore: number;
}

export interface IssueSalience {
  economic: number;
  social: number;
  overall: number;
}

export interface CandidatePosition {
  economic: number;
  social: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function populationAt(vector: AgeSexVectorInput, age: number): number {
  return Math.max(0, vector.male[age] ?? 0) + Math.max(0, vector.female[age] ?? 0);
}

function sumAges(vector: AgeSexVectorInput, lower: number, upper: number): number {
  let total = 0;
  for (let age = Math.max(0, lower); age <= Math.min(100, upper); age++) {
    total += populationAt(vector, age);
  }
  return total;
}

/**
 * Convert the live population stock into the four age buckets used by every
 * current Layer-1 electorate. Children and people below the legal voting age
 * are excluded, so the result describes the electorate rather than residents.
 */
export function liveElectorateAgeMarginals(
  vector: AgeSexVectorInput,
  votingAge = 18
): Record<"young" | "mid" | "mature" | "senior", number> | null {
  const minimum = clamp(Math.floor(votingAge), 0, 100);
  const counts = {
    young: sumAges(vector, minimum, 29),
    mid: sumAges(vector, Math.max(minimum, 30), 44),
    mature: sumAges(vector, Math.max(minimum, 45), 64),
    senior: sumAges(vector, Math.max(minimum, 65), 100),
  };
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return null;
  return Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [key, (count / total) * 100])
  ) as Record<"young" | "mid" | "mature" | "senior", number>;
}

/** Restore an exact marginal after cell pruning while preserving within-bucket proportions. */
export function reweightSharesToMarginal<
  T extends { share: number; buckets: Readonly<Record<string, string>> },
>(rows: readonly T[], dimension: string, percentages: Readonly<Record<string, number>>): T[] {
  if (rows.length === 0) return [];
  const current: Record<string, number> = {};
  for (const row of rows) {
    const bucket = row.buckets[dimension];
    if (bucket) current[bucket] = (current[bucket] ?? 0) + row.share;
  }
  const weighted = rows.map((row) => {
    const bucket = row.buckets[dimension];
    const target = (percentages[bucket] ?? 0) / 100;
    const observed = current[bucket] ?? 0;
    return { ...row, share: observed > 0 ? row.share * (target / observed) : 0 };
  });
  const total = weighted.reduce((sum, row) => sum + row.share, 0);
  return total > 0 ? weighted.map((row) => ({ ...row, share: row.share / total })) : [...rows];
}

/** Resolve a bounded, auditable turnout rate from additive percentage-point terms. */
export function resolveParticipation(
  context: ParticipationContext,
  calibration: DemographicsV2Calibration = DEFAULT_DEMOGRAPHICS_V2_CALIBRATION
): ParticipationLedger {
  const salience = (clamp(context.salience, 0, 1) - 0.5) * calibration.salienceRangePoints;
  const competitiveness =
    clamp(context.competitiveness, 0, 1) * calibration.competitivenessMaxPoints;
  const access = -clamp(context.accessFriction, 0, 1) * calibration.accessMaxPoints;
  const contact = clamp(
    context.contactLift ?? 0,
    -calibration.contactCapPoints,
    calibration.contactCapPoints
  );
  const saturation =
    -Math.abs(contact) *
    clamp(context.saturation ?? 0, 0, 1) *
    calibration.saturationPenaltyFraction;
  const resolvedTurnout = clamp(
    context.baselineTurnout + salience + competitiveness + access + contact + saturation,
    calibration.turnoutFloor,
    calibration.turnoutCeiling
  );
  return {
    baseline: context.baselineTurnout,
    salience,
    competitiveness,
    access,
    contact,
    saturation,
    resolvedTurnout,
  };
}

/**
 * Apply the legal registered-voter gate once and expose its full effect in the
 * same percentage-point ledger players see. The gate is multiplicative because
 * it limits every participation term equally, not only the structural baseline.
 */
export function applyRegisteredShareToParticipation(
  ledger: ParticipationLedger,
  registeredShare: number
): ParticipationLedger {
  const resolvedTurnout = ledger.resolvedTurnout * clamp(registeredShare, 0, 1);
  return {
    ...ledger,
    access: ledger.access + resolvedTurnout - ledger.resolvedTurnout,
    resolvedTurnout,
  };
}

/**
 * Candidate contrast makes an axis more important without inventing a new
 * ideology scale. A quiet axis is slightly compressed; a sharply contested
 * axis is slightly amplified. The average drives participation.
 */
export function resolveIssueSalience(
  candidates: readonly CandidatePosition[],
  calibration: DemographicsV2Calibration = DEFAULT_DEMOGRAPHICS_V2_CALIBRATION
): IssueSalience {
  if (candidates.length < 2) return { economic: 1, social: 1, overall: 0.5 };
  const economicValues = candidates.map((candidate) => candidate.economic);
  const socialValues = candidates.map((candidate) => candidate.social);
  const contrast = (values: number[]): number =>
    clamp((Math.max(...values) - Math.min(...values)) / calibration.issueContrastSpan, 0, 1);
  const economicContrast = contrast(economicValues);
  const socialContrast = contrast(socialValues);
  return {
    economic:
      calibration.issueAxisMin +
      economicContrast * (calibration.issueAxisMax - calibration.issueAxisMin),
    social:
      calibration.issueAxisMin +
      socialContrast * (calibration.issueAxisMax - calibration.issueAxisMin),
    overall: (economicContrast + socialContrast) / 2,
  };
}

/** A close top-two favorability race produces the strongest participation cue. */
export function resolveCompetitiveness(
  favorabilities: readonly number[],
  calibration: DemographicsV2Calibration = DEFAULT_DEMOGRAPHICS_V2_CALIBRATION
): number {
  if (favorabilities.length < 2) return 0;
  const [first, second] = [...favorabilities].sort((a, b) => b - a);
  return clamp(1 - Math.abs(first - second) / calibration.competitiveGapSpan, 0, 1);
}

/** Collapse unit-level ledgers into one electorate-weighted public explanation. */
export function summarizeParticipation(input: {
  calibration: DemographicsV2Calibration;
  competitiveness: number;
  issueSalience: IssueSalience;
  rows: ReadonlyArray<{ share: number; ledger: ParticipationLedger }>;
}): ParticipationSummary | null {
  const total = input.rows.reduce((sum, row) => sum + Math.max(0, row.share), 0);
  if (total <= 0) return null;
  const weighted = (pick: (ledger: ParticipationLedger) => number): number =>
    input.rows.reduce((sum, row) => sum + Math.max(0, row.share) * pick(row.ledger), 0) / total;
  return {
    calibrationId: input.calibration.id,
    economicSalience: input.issueSalience.economic,
    socialSalience: input.issueSalience.social,
    competitivenessScore: clamp(input.competitiveness, 0, 1),
    baseline: weighted((ledger) => ledger.baseline),
    salience: weighted((ledger) => ledger.salience),
    competitiveness: weighted((ledger) => ledger.competitiveness),
    access: weighted((ledger) => ledger.access),
    contact: weighted((ledger) => ledger.contact),
    saturation: weighted((ledger) => ledger.saturation),
    resolvedTurnout: weighted((ledger) => ledger.resolvedTurnout),
  };
}
