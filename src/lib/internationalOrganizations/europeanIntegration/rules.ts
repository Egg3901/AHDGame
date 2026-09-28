/**
 * The European Community keeps its members and agreements when a treaty fails.
 * Maastricht opens ratification in 1992; reconcileEuropeanTreaty requires every
 * current member's recorded consent before the Union can take effect in 1993.
 */
export type EuropeanStage = "community" | "union";
export interface EuropeanRatification {
  approved: boolean;
  decisionId: string;
  turn: number;
}
export interface EuropeanIntegrationState {
  stage: EuropeanStage;
  source: "historical-seed" | "legacy-settlement" | "ratified-treaty";
  establishedTurn: number;
  ratifications: Record<string, EuropeanRatification>;
  treatyEffectiveTurn?: number;
}

export const COMMUNITY_FOUNDERS = ["BE", "DE", "FR", "IT", "LU", "NL"] as const;
export const COMMUNITY_MEMBERS_1979 = [...COMMUNITY_FOUNDERS, "DK", "IE", "UK"] as const;
export const COMMUNITY_MEMBERS_1991 = [...COMMUNITY_MEMBERS_1979, "GR", "ES", "PT"] as const;

/** ISO calendar dates compare lexically after strict shape validation. */
function onOrAfter(date: string, threshold: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= threshold;
}

export function canRatifyMaastricht(date: string, stage: EuropeanStage): boolean {
  return stage === "community" && onOrAfter(date, "1992-02-07");
}

export function recordEuropeanRatification(input: {
  state: EuropeanIntegrationState;
  date: string;
  members: readonly string[];
  countryId: string;
  decision: EuropeanRatification;
}): EuropeanIntegrationState {
  if (!canRatifyMaastricht(input.date, input.state.stage)) return input.state;
  if (!input.members.includes(input.countryId)) return input.state;
  const previous = input.state.ratifications[input.countryId];
  // A replay cannot resurrect a superseded decision or rewrite its provenance.
  if (
    previous &&
    (previous.decisionId === input.decision.decisionId || previous.turn >= input.decision.turn)
  )
    return input.state;
  return {
    ...input.state,
    ratifications: { ...input.state.ratifications, [input.countryId]: input.decision },
  };
}

export function reconcileEuropeanTreaty(input: {
  state: EuropeanIntegrationState;
  date: string;
  turn: number;
  members: readonly string[];
}): EuropeanIntegrationState {
  if (input.state.stage === "union" || !onOrAfter(input.date, "1993-11-01")) return input.state;
  const members = [...new Set(input.members)];
  // An empty organization cannot ratify a treaty through vacuous unanimity.
  if (
    members.length < 2 ||
    !members.every((member) => input.state.ratifications[member]?.approved === true)
  )
    return input.state;
  return {
    ...input.state,
    stage: "union",
    source: "ratified-treaty",
    treatyEffectiveTurn: input.turn,
  };
}

/** A real withdrawal ends that state's ratification, so re-entry requires a new vote. */
export function withdrawEuropeanRatification(
  state: EuropeanIntegrationState,
  countryId: string
): EuropeanIntegrationState {
  if (!state.ratifications[countryId]) return state;
  const ratifications = { ...state.ratifications };
  delete ratifications[countryId];
  return { ...state, ratifications };
}
