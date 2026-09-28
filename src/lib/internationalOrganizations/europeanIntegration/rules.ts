/**
 * The European Community keeps its members and agreements when a treaty fails.
 * Maastricht opens ratification in 1992; reconcileEuropeanTreaty requires every
 * current member's recorded consent before the Union can take effect in 1993.
 */
export type EuropeanStage = "community" | "union";
export interface EuropeanRatification {
  source?: "national-law" | "background-government";
  reasons?: string[];
  approved: boolean;
  decisionId: string;
  membershipId?: string;
  turn: number;
}
export interface EuropeanIntegrationState {
  revision?: number;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && date >= threshold;
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
    (previous.decisionId === input.decision.decisionId ||
      previous.turn > input.decision.turn ||
      (previous.turn === input.decision.turn && previous.decisionId >= input.decision.decisionId))
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
  membershipIds?: Readonly<Record<string, string>>;
}): EuropeanIntegrationState {
  if (input.state.stage === "union" || !onOrAfter(input.date, "1993-11-01")) return input.state;
  const members = [...new Set(input.members)];
  // An empty organization cannot ratify a treaty through vacuous unanimity.
  if (
    members.length < 2 ||
    !members.every(
      (member) =>
        input.state.ratifications[member]?.approved === true &&
        (!input.membershipIds ||
          input.state.ratifications[member]?.membershipId === input.membershipIds[member])
    )
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

export function initialEuropeanIntegration(input: {
  startingYear: number;
  currentTurn: number;
  hasEuropeanMembers: boolean;
}): EuropeanIntegrationState {
  const legacy = input.hasEuropeanMembers || input.currentTurn > 1;
  return {
    stage: input.hasEuropeanMembers || input.startingYear >= 1993 ? "union" : "community",
    source: legacy ? "legacy-settlement" : "historical-seed",
    establishedTurn: input.currentTurn,
    ratifications: {},
  };
}

export interface BackgroundTreatyConditions {
  countryId: string;
  membershipId: string;
  stability: number;
  tradeExposure: number;
  fiscalCapacity: number;
  economicSystem: "market" | "planned";
}

/**
 * Background governments review Maastricht once per game year. Consent depends
 * on economic openness and institutional capacity; calendar time alone cannot
 * turn a rejection into approval. Domestic legislatures use enacted bills.
 */
export function decideBackgroundMaastricht(input: {
  state: EuropeanIntegrationState;
  date: string;
  turn: number;
  members: readonly string[];
  country: BackgroundTreatyConditions;
}): EuropeanRatification | undefined {
  const { country, state, turn } = input;
  if (!canRatifyMaastricht(input.date, state.stage) || !input.members.includes(country.countryId))
    return undefined;
  const previous = state.ratifications[country.countryId];
  if (previous?.membershipId === country.membershipId) {
    // A parliamentary decision is never replaced by background automation.
    if (
      previous.source !== "background-government" ||
      previous.approved ||
      turn < previous.turn + 48
    )
      return undefined;
  }
  if (
    ![country.stability, country.tradeExposure, country.fiscalCapacity].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1
    )
  )
    return undefined;
  const reasons: string[] = [];
  if (country.economicSystem !== "market")
    reasons.push("Economic institutions are not ready for the common market.");
  if (country.stability < 0.35) reasons.push("Domestic instability prevents treaty commitments.");
  if (country.fiscalCapacity < 0.15)
    reasons.push("Fiscal capacity is too weak to implement treaty obligations.");
  if (country.tradeExposure < 0.15)
    reasons.push("Limited trade exposure leaves insufficient support for integration.");
  const approved = reasons.length === 0;
  if (approved) reasons.push("Trade integration and stable institutions support ratification.");
  return {
    approved,
    decisionId: `maastricht:${country.countryId}:${country.membershipId}:${turn}`,
    membershipId: country.membershipId,
    turn,
    source: "background-government",
    reasons,
  };
}

/** Common-market access follows current membership, independently of Maastricht consent. */
export function europeanCommonMarketPairs(members: readonly string[]): string[] {
  const countries = [...new Set(members.filter(Boolean))].sort();
  const pairs: string[] = [];
  for (let i = 0; i < countries.length; i++)
    for (let j = i + 1; j < countries.length; j++) pairs.push(`${countries[i]}|${countries[j]}`);
  return pairs;
}
