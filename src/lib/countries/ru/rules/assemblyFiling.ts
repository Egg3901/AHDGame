/**
 * First-Duma filing needs the ratified cohort and an eligible Russian residence.
 * decideRussianDumaFiling admits national party lists from any Russian region,
 * keeps independents in their home constituencies and limits each player to one seat.
 */
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../data/ruPopulation1991";
import { planRussianDumaDistricts } from "./assemblyDistricts";
import { hasAuthorizedPostSovietTransition } from "./postSovietTransition";
const districts = new Map(
  planRussianDumaDistricts(
    Object.fromEntries(Object.keys(RU_1991_ECONOMIC_REGION_POPULATION).map((id) => [id, 1]))
  ).map((row) => [row.seatId, row])
);
export interface RussianDumaFilingInput {
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
    mandateSinceTurn: number;
    tier: "constituency" | "list";
  };
  character: {
    countryId: string;
    homeState: string;
    party: string;
    pendingRelocation: boolean;
    recognizedParty: boolean;
    holdsConstituencyMandate?: boolean;
    holdsCouncilMandate?: boolean;
    incompatibleOffice?: boolean;
  };
}
export type RussianDumaFilingDecision =
  | {
      allowed: true;
      nationalList: boolean;
      nomination: { registrationOrder: number; nominationOrder: number; capacity: 1 };
    }
  | {
      allowed: false;
      reason:
        | "unbound-mandate"
        | "invalid-ballot"
        | "filing-closed"
        | "invalid-residence"
        | "independent-list"
        | "unregistered-list"
        | "constituency-mandate"
        | "council-mandate"
        | "incompatible-office";
    };
export function decideRussianDumaFiling(input: RussianDumaFilingInput): RussianDumaFilingDecision {
  const { election, character } = input;
  if (
    input.preset !== "1991-default" ||
    !input.boundCohortId ||
    election.cohortId !== input.boundCohortId ||
    election.mandateSinceTurn !== input.mandateSinceTurn ||
    !hasAuthorizedPostSovietTransition(
      input.turn,
      input.successionSinceTurn,
      input.mandateSinceTurn
    )
  )
    return { allowed: false, reason: "unbound-mandate" };
  if (
    election.countryId !== "RU" ||
    election.type !== "dumaDeputy" ||
    !Number.isSafeInteger(input.registrationOrder) ||
    input.registrationOrder < 0 ||
    !Number.isSafeInteger(election.primaryEndTurn) ||
    (election.primaryEndTurn ?? 0) <= election.mandateSinceTurn
  )
    return { allowed: false, reason: "invalid-ballot" };
  if (input.turn >= election.primaryEndTurn!) return { allowed: false, reason: "filing-closed" };
  if (
    character.countryId !== "RU" ||
    character.pendingRelocation ||
    !Object.prototype.hasOwnProperty.call(RU_1991_ECONOMIC_REGION_POPULATION, character.homeState)
  )
    return { allowed: false, reason: "invalid-residence" };
  if (character.holdsCouncilMandate) return { allowed: false, reason: "council-mandate" };
  if (character.incompatibleOffice) return { allowed: false, reason: "incompatible-office" };
  const nationalList = election.tier === "list";
  if (nationalList) {
    if (
      election.state !== "RU" ||
      election.seatId !== "RU-duma-national-list" ||
      election.totalSeats !== 225
    )
      return { allowed: false, reason: "invalid-ballot" };
    if (!character.party || character.party === "independent")
      return { allowed: false, reason: "independent-list" };
    if (!character.recognizedParty) return { allowed: false, reason: "unregistered-list" };
  } else {
    if (character.holdsConstituencyMandate)
      return { allowed: false, reason: "constituency-mandate" };
    const district = districts.get(election.seatId);
    if (
      election.tier !== "constituency" ||
      !district ||
      election.totalSeats !== 1 ||
      election.state !== district.regionId
    )
      return { allowed: false, reason: "invalid-ballot" };
    if (character.homeState !== election.state)
      return { allowed: false, reason: "invalid-residence" };
  }
  return {
    allowed: true,
    nationalList,
    nomination: {
      registrationOrder: input.registrationOrder,
      nominationOrder: input.registrationOrder,
      capacity: 1,
    },
  };
}
