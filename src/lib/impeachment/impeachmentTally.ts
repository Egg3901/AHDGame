import type { Db } from "@/lib/mongodb";
import {
  COUNTRY_CONFIGS,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import { officialsCountryScope } from "@/lib/db/electedOfficialScope";
import type { ImpeachmentVoteValue } from "@/lib/db/types/impeachment";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";

export interface ChamberTally {
  for: number;
  against: number;
  seats: number;
}

/**
 * Impeachment bars, measured against ALL seats in the chamber, never votes
 * cast: an abstention, a partyless bloc, or a seat that never voted counts
 * AGAINST passage. House articles need a strict majority of the full chamber;
 * Senate conviction needs at least two-thirds of the full chamber. Each bar is
 * a numerator/denominator seat share compared with exact integer math, so
 * retuning either bar is a one-line constant edit.
 */
export const IMPEACHMENT_HOUSE_BAR = { num: 1, den: 2 } as const;
export const IMPEACHMENT_SENATE_BAR = { num: 2, den: 3 } as const;

/** Smallest seat-weighted aye count that carries the House bar at `seats` seats. */
export function houseImpeachmentVotesNeeded(seats: number): number {
  // Strict majority: for * den > seats * num.
  return Math.floor((seats * IMPEACHMENT_HOUSE_BAR.num) / IMPEACHMENT_HOUSE_BAR.den) + 1;
}

/** Smallest seat-weighted aye count that meets the Senate bar at `seats` seats. */
export function senateConvictionVotesNeeded(seats: number): number {
  // Inclusive share: for * den >= seats * num.
  const { num, den } = IMPEACHMENT_SENATE_BAR;
  return Math.ceil((seats * num) / den);
}

/** Country-scoped filter for the officials seated in one impeachment chamber. */
export function impeachmentChamberOfficialFilter(
  countryId: CountryId,
  officeType: string,
  state?: string
): Record<string, unknown> {
  const stateScope = state ? { state } : {};
  return { officeType, ...stateScope, ...officialsCountryScope(countryId) };
}

/**
 * Seat-weighted tally of an impeachment vote map for one chamber. Votes are
 * keyed by characterId or `npp_<id>`; each seated official contributes
 * `seatsHeld` weight (multi-seat NPP blocs count fully). Abstentions and stale
 * voters (no longer seated) contribute nothing to for/against. Recomputed from
 * live seats at resolution time so the cached tally fields are display-only.
 */
export async function tallyImpeachmentChamber(
  db: Db,
  countryId: CountryId,
  officeType: string,
  votes: Record<string, ImpeachmentVoteValue> | undefined,
  state?: string
): Promise<ChamberTally> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(impeachmentChamberOfficialFilter(countryId, officeType, state))
    .project<Pick<ElectedOfficial, "characterId" | "nppId" | "seatsHeld">>({
      characterId: 1,
      nppId: 1,
      seatsHeld: 1,
    })
    .toArray();

  const seatByKey = new Map<string, number>();
  let seats = 0;
  for (const o of officials) {
    const weight = o.seatsHeld ?? 1;
    seats += weight;
    if (o.characterId) seatByKey.set(o.characterId.toString(), weight);
    if (o.nppId) seatByKey.set(`npp_${o.nppId.toString()}`, weight);
  }

  let votesFor = 0;
  let votesAgainst = 0;
  if (votes) {
    for (const [key, vote] of Object.entries(votes)) {
      const weight = seatByKey.get(key);
      if (!weight) continue;
      if (vote === "aye") votesFor += weight;
      else if (vote === "nay") votesAgainst += weight;
    }
  }
  return { for: votesFor, against: votesAgainst, seats };
}

/** Total seated weight in one of the case's chambers (the all-seats denominator). */
export async function countChamberSeats(
  db: Db,
  countryId: CountryId,
  officeType: string,
  state?: string
): Promise<number> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(impeachmentChamberOfficialFilter(countryId, officeType, state))
    .project<Pick<ElectedOfficial, "seatsHeld">>({ seatsHeld: 1 })
    .toArray();
  return officials.reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0);
}

/**
 * The chamber that votes at an open case's current stage: the lower chamber
 * during the House stage, the upper chamber (or a governor's state legislature)
 * during the Senate/conviction stage. Null once the case is no longer open.
 */
export function impeachmentStageChamberOfficeType(
  impeachment: Pick<ImpeachmentLite, "targetOffice" | "stage" | "countryId" | "state">
): string | undefined {
  if (impeachment.targetOffice === "governor") {
    return impeachment.stage === "senate"
      ? getSubNationalLegislatureKey(impeachment.countryId)
      : undefined;
  }
  return impeachment.stage === "house"
    ? getLowerChamberOfficeType(impeachment.countryId)
    : getUpperChamberOfficeType(impeachment.countryId);
}

/**
 * The whippable chamber KEY for an open case's current stage, as opposed to
 * {@link impeachmentStageChamberOfficeType}'s office type. Whip documents and
 * the whip panels address chambers by key, and the two differ for some
 * countries (CN's key "npc" vs office "npcDelegate"), so a whip must never be
 * keyed off the office type. Null once the case is no longer open.
 */
export function impeachmentStageChamberKey(
  impeachment: Pick<ImpeachmentLite, "targetOffice" | "stage" | "countryId">
): string | null {
  if (impeachment.stage !== "house" && impeachment.stage !== "senate") return null;
  // A governor is tried in a single sitting of the state legislature, which the
  // case models as its "senate" (conviction) stage; it has no House stage.
  if (impeachment.targetOffice === "governor") {
    return impeachment.stage === "senate"
      ? getSubNationalLegislatureKey(impeachment.countryId)
      : null;
  }
  const config = COUNTRY_CONFIGS[impeachment.countryId];
  const lowerKey = config.legislature.lowerChamber.key;
  if (impeachment.stage === "house") return lowerKey;
  return config.legislature.upperChamber?.key ?? lowerKey;
}

/** Minimal shape of an impeachment doc the chamber helpers need. */
export interface ImpeachmentLite {
  targetOffice: string;
  stage: string;
  countryId: CountryId;
  state?: string;
}

/** House impeaches on a seat-weighted strict majority of ALL chamber seats. */
export function passesHouseImpeachment(t: ChamberTally): boolean {
  return t.for * IMPEACHMENT_HOUSE_BAR.den > t.seats * IMPEACHMENT_HOUSE_BAR.num;
}

/**
 * Senate convicts on a seat-weighted two-thirds of ALL chamber seats (the
 * governor's single-chamber trial uses the same bar). Abstentions and seats
 * that never voted count against conviction; an empty chamber fails.
 */
export function passesSenateConviction(t: ChamberTally): boolean {
  return t.seats > 0 && t.for * IMPEACHMENT_SENATE_BAR.den >= t.seats * IMPEACHMENT_SENATE_BAR.num;
}
