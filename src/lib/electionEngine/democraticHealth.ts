/**
 * Presidential vote pressure from a country's institutional health.
 *
 * The pressure begins below the "Functioning democracy" boundary and grows
 * nonlinearly as the score falls. The ruling party carries the base drag;
 * the sitting President carries an additional personal drag. Temporary relief
 * can soften only that additional personal portion, so a crisis response never
 * erases the broader ruling-party accountability.
 */

export {
  DEMOCRATIC_HEALTH_CURRENT_RULER_EXTRA_MAX,
  DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD,
  DEMOCRATIC_HEALTH_GDP_DRAG_MAX,
  DEMOCRATIC_HEALTH_PARTY_PENALTY_MAX,
  DEMOCRATIC_HEALTH_RELIEF_CAP_PCT,
  democraticHealthEconomicDrag,
  democraticHealthPressure,
} from "@/lib/governanceStyle/rules/democraticConsequences";

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
  /** Annual GDP-growth percentage points lost at this health score. */
  economicDragPctPoints: number;
  currentRulerReliefPct: number;
  currentRulerInRace: boolean;
  recordedTurn: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
