/**
 * Council candidates contest one subject in their current Russian home macroregion.
 * decideRussianCouncilFiling validates the ratified opening, filing window and
 * association's two-nominee limit, excluding players with another chamber mandate.
 */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import { hasAuthorizedPostSovietTransition } from "./postSovietTransition";
const districts = new Map(
  RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number, name, region]) => [
    `RU-council-${number}`,
    { number, name, region },
  ])
);

export interface RussianCouncilFilingInput {
  preset: string;
  turn: number;
  registrationOrder: number;
  successionSinceTurn?: number;
  mandateSinceTurn?: number;
  boundCohortId?: string;
  election: {
    countryId: string;
    type: string;
    state: string;
    seatId: string;
    totalSeats: number;
    primaryEndTurn?: number;
    cohortId: string;
    rootCohortId?: string;
    mandateSinceTurn: number;
    districtNumber: number;
  };
  character: {
    countryId: string;
    homeState: string;
    party: string;
    pendingRelocation: boolean;
    recognizedParty: boolean;
    holdsOtherChamberMandate: boolean;
    holdsCouncilMandate: boolean;
    hasOtherActiveCandidacy: boolean;
  };
  associationNominees: number;
}
export type RussianCouncilFilingDecision =
  | { allowed: true; nomination: { registrationOrder: number } }
  | {
      allowed: false;
      reason:
        | "unbound-mandate"
        | "invalid-ballot"
        | "filing-closed"
        | "invalid-residence"
        | "unregistered-association"
        | "association-full"
        | "other-chamber-mandate"
        | "council-mandate"
        | "other-candidacy";
    };

export function decideRussianCouncilFiling(
  input: RussianCouncilFilingInput
): RussianCouncilFilingDecision {
  const { election, character } = input;
  if (
    input.preset !== "1991-default" ||
    !input.boundCohortId ||
    (election.rootCohortId ?? election.cohortId) !== input.boundCohortId ||
    election.mandateSinceTurn !== input.mandateSinceTurn ||
    !hasAuthorizedPostSovietTransition(
      input.turn,
      input.successionSinceTurn,
      input.mandateSinceTurn
    )
  )
    return { allowed: false, reason: "unbound-mandate" };
  const district = districts.get(election.seatId);
  if (
    election.countryId !== "RU" ||
    election.type !== "federationCouncilMember" ||
    election.totalSeats !== 2 ||
    !district ||
    election.state !== district.region ||
    election.districtNumber !== district.number ||
    !Number.isSafeInteger(input.registrationOrder) ||
    input.registrationOrder < 0 ||
    !Number.isSafeInteger(election.primaryEndTurn) ||
    (election.primaryEndTurn ?? 0) <= election.mandateSinceTurn ||
    !Number.isSafeInteger(input.associationNominees) ||
    input.associationNominees < 0
  )
    return { allowed: false, reason: "invalid-ballot" };
  if (input.turn >= election.primaryEndTurn!) return { allowed: false, reason: "filing-closed" };
  if (
    character.countryId !== "RU" ||
    character.homeState !== district.region ||
    character.pendingRelocation
  )
    return { allowed: false, reason: "invalid-residence" };
  if (character.holdsOtherChamberMandate)
    return { allowed: false, reason: "other-chamber-mandate" };
  if (character.holdsCouncilMandate) return { allowed: false, reason: "council-mandate" };
  if (character.hasOtherActiveCandidacy) return { allowed: false, reason: "other-candidacy" };
  if (!character.party || (character.party !== "independent" && !character.recognizedParty))
    return { allowed: false, reason: "unregistered-association" };
  // Independents belong to their own nominating voter groups, not one shared association.
  if (character.party !== "independent" && input.associationNominees >= 2)
    return { allowed: false, reason: "association-full" };
  return { allowed: true, nomination: { registrationOrder: input.registrationOrder } };
}
