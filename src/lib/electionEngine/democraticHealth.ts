/**
 * Presidential vote pressure from a country's institutional health.
 *
 * The pressure begins below the "Functioning democracy" boundary and grows
 * nonlinearly as the score falls. The ruling party carries the base drag;
 * the sitting President carries an additional personal drag. Temporary relief
 * can soften only that additional personal portion, so a crisis response never
 * erases the broader ruling-party accountability.
 */

export const DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD = 60;
export const DEMOCRATIC_HEALTH_PARTY_PENALTY_MAX = 0.1;
export const DEMOCRATIC_HEALTH_CURRENT_RULER_EXTRA_MAX = 0.05;
export const DEMOCRATIC_HEALTH_RELIEF_CAP_PCT = 75;
const DEMOCRATIC_HEALTH_SEVERITY_EXPONENT = 1.35;

export interface DemocraticHealthPressure {
  value: number;
  /** 0 at the threshold, 1 at zero health. */
  severity: number;
  /** Base multiplier reduction for every candidate in the ruling party. */
  partyPenalty: number;
  /** Total multiplier reduction for the current ruler. */
  currentRulerPenalty: number;
  /** Relief after clamping to the supported temporary-relief range. */
  reliefPct: number;
}

export interface DemocraticHealthCandidateInput {
  candidateParty: string;
  candidateCharacterId?: string;
  rulingPartyId?: string;
  currentRulerCharacterId?: string;
  partyPenalty: number;
  currentRulerPenalty: number;
}

/** Read-only turn snapshot shared by tally persistence and the Presidential UI. */
export interface DemocraticHealthElectionSnapshot {
  value: number;
  label: string;
  rulingPartyId?: string;
  partyPenaltyPct: number;
  currentRulerPenaltyPct: number;
  currentRulerReliefPct: number;
  currentRulerInRace: boolean;
  recordedTurn: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert the displayed 0..100 health score into election pressure.
 *
 * Health at or above 60 is neutral. Below 60, the normalized shortfall is
 * raised to an exponent greater than one so the first signs of institutional
 * strain are moderate while deeper failures become increasingly costly.
 */
export function democraticHealthPressure(value: number, reliefPct = 0): DemocraticHealthPressure {
  const safeValue = clamp(Number.isFinite(value) ? value : 50, 0, 100);
  const safeReliefPct = clamp(
    Number.isFinite(reliefPct) ? reliefPct : 0,
    0,
    DEMOCRATIC_HEALTH_RELIEF_CAP_PCT
  );
  const shortfall = clamp(
    (DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD - safeValue) / DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD,
    0,
    1
  );
  const severity = Math.pow(shortfall, DEMOCRATIC_HEALTH_SEVERITY_EXPONENT);
  const partyPenalty = DEMOCRATIC_HEALTH_PARTY_PENALTY_MAX * severity;
  const currentRulerPenalty =
    partyPenalty + DEMOCRATIC_HEALTH_CURRENT_RULER_EXTRA_MAX * severity * (1 - safeReliefPct / 100);

  return {
    value: safeValue,
    severity,
    partyPenalty,
    currentRulerPenalty,
    reliefPct: safeReliefPct,
  };
}

/** Return the candidate's nominal-share multiplier for the health channel. */
export function democraticHealthMultiplierForCandidate(
  input: DemocraticHealthCandidateInput
): number {
  if (!input.rulingPartyId || input.candidateParty !== input.rulingPartyId) return 1;
  const isCurrentRuler =
    input.currentRulerCharacterId != null &&
    input.candidateCharacterId === input.currentRulerCharacterId;
  const penalty = isCurrentRuler ? input.currentRulerPenalty : input.partyPenalty;
  return clamp(1 - Math.max(0, penalty), 0, 1);
}
