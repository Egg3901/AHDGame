/**
 * Later Council membership follows an enacted choice and actual regional authority.
 * planRussianCouncilComposition keeps both representatives of each federal subject
 * distinct and ties delegated mandates to the authority that appoints them.
 */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import { turnToGameMonth } from "@/lib/utils/gameDate";
export type RussianCouncilCompositionMode = "regionalHeads" | "regionalDelegates";
export type RussianCouncilAuthorityBranch = "executive" | "legislative";
export function russianRegionalCouncilOfficeCompatible(input: {
  officeType?: string;
  countryId?: string;
  isNpc: boolean;
}) {
  if (!input.officeType) return true;
  if (input.countryId !== "RU") return false;
  return (
    input.officeType === "federationCouncilMember" ||
    (!input.isNpc && ["governor", "regionalCouncil"].includes(input.officeType))
  );
}
export interface RussianCouncilRegionalPerson {
  personId: string;
  ownerId: string;
  isNpc: boolean;
  name: string;
  party: string;
  eligible: boolean;
}
export interface RussianCouncilRegionalAuthority {
  subjectId: string;
  regionId: string;
  branch: RussianCouncilAuthorityBranch;
  revision: number;
  head: RussianCouncilRegionalPerson;
  sinceTurn: number;
  termEndTurn?: number;
  delegate?: RussianCouncilRegionalPerson & {
    appointedByPersonId: string;
    appointedOnTurn: number;
    appointmentRevision?: number;
  };
}
export function russianCouncilCompositionAvailable(input: {
  mode: RussianCouncilCompositionMode;
  preset?: string;
  calendarTurn: number;
  currentTurn: number;
  assemblySinceTurn?: number;
  enactedMode?: RussianCouncilCompositionMode;
}) {
  if (input.preset !== "1991-default") return { available: false, reason: "other-era" as const };
  if (
    !Number.isSafeInteger(input.currentTurn) ||
    input.currentTurn < 1 ||
    !Number.isSafeInteger(input.calendarTurn) ||
    input.calendarTurn < 1
  )
    throw new Error("Council composition needs safe raw and calendar turns");
  const { year, month } = turnToGameMonth(input.calendarTurn, 1991);
  const dated =
    input.mode === "regionalHeads"
      ? year > 1995 || (year === 1995 && month >= 11)
      : year > 2000 || (year === 2000 && month >= 7);
  if (!dated) return { available: false, reason: "before-date" as const };
  if (
    !Number.isSafeInteger(input.assemblySinceTurn) ||
    !input.assemblySinceTurn ||
    input.assemblySinceTurn < 1 ||
    input.assemblySinceTurn > input.currentTurn
  )
    return { available: false, reason: "awaiting-assembly" as const };
  if (
    input.enactedMode === input.mode ||
    (input.mode === "regionalHeads" && input.enactedMode === "regionalDelegates")
  )
    return { available: false, reason: "already-authorized" as const };
  return { available: true, reason: "available" as const };
}
export function passesRussianCouncilFormationLaw(votesFor: number, seats: number) {
  return (
    Number.isSafeInteger(votesFor) &&
    votesFor >= 0 &&
    Number.isSafeInteger(seats) &&
    seats > 0 &&
    votesFor <= seats &&
    BigInt(votesFor) * BigInt(2) > BigInt(seats)
  );
}
export function planRussianCouncilComposition(input: {
  mode: RussianCouncilCompositionMode;
  turn: number;
  authorities: readonly RussianCouncilRegionalAuthority[];
}) {
  if (!Number.isSafeInteger(input.turn) || input.turn < 1)
    throw new Error("Council formation needs a safe current turn");
  const expected = new Map(
    RUSSIAN_COUNCIL_SUBJECTS_1993.map(([id, , region]) => [`RU-council-${id}`, region])
  );
  if (input.authorities.length !== 178)
    throw new Error("Council formation needs all 178 regional authority slots");
  const slots = new Set<string>(),
    people = new Set<string>(),
    humanOwners = new Set<string>();
  const seats: Array<
    RussianCouncilRegionalPerson & {
      subjectId: string;
      regionId: string;
      branch: RussianCouncilAuthorityBranch;
      authorityRevision: number;
      authorityPersonId: string;
      termEndTurn?: number;
    }
  > = [];
  const vacancies: Array<{
    subjectId: string;
    branch: RussianCouncilAuthorityBranch;
    reason: "expired-authority" | "missing-delegate" | "ineligible-owner";
  }> = [];
  for (const row of input.authorities) {
    const slot = `${row.subjectId}:${row.branch}`;
    if (
      expected.get(row.subjectId) !== row.regionId ||
      !["executive", "legislative"].includes(row.branch) ||
      slots.has(slot) ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !Number.isSafeInteger(row.sinceTurn) ||
      row.sinceTurn < 1 ||
      row.sinceTurn > input.turn ||
      (row.termEndTurn != null &&
        (!Number.isSafeInteger(row.termEndTurn) || row.termEndTurn <= row.sinceTurn))
    )
      throw new Error("Council formation needs distinct valid regional authorities");
    slots.add(slot);
    const validatePerson = (person: RussianCouncilRegionalPerson) => {
      if (
        !person.personId ||
        !person.ownerId ||
        !person.name ||
        !person.party ||
        typeof person.isNpc !== "boolean" ||
        typeof person.eligible !== "boolean"
      )
        throw new Error("Council regional authority needs a named existing owner");
    };
    validatePerson(row.head);
    if (people.has(row.head.personId))
      throw new Error("A regional head cannot represent two authority slots");
    people.add(row.head.personId);
    if (row.termEndTurn != null && row.termEndTurn <= input.turn) {
      vacancies.push({ subjectId: row.subjectId, branch: row.branch, reason: "expired-authority" });
      continue;
    }
    const person = input.mode === "regionalHeads" ? row.head : row.delegate;
    if (!person) {
      vacancies.push({ subjectId: row.subjectId, branch: row.branch, reason: "missing-delegate" });
      continue;
    }
    validatePerson(person);
    if (input.mode === "regionalDelegates") {
      const delegate = row.delegate!;
      if (
        delegate.personId === row.head.personId ||
        delegate.appointedByPersonId !== row.head.personId ||
        !Number.isSafeInteger(delegate.appointedOnTurn) ||
        delegate.appointedOnTurn < row.sinceTurn ||
        delegate.appointedOnTurn > input.turn ||
        (delegate.appointmentRevision != null &&
          (!Number.isSafeInteger(delegate.appointmentRevision) ||
            delegate.appointmentRevision < 1)) ||
        people.has(delegate.personId)
      )
        throw new Error("Council delegate needs its actual appointing regional authority");
      people.add(delegate.personId);
    }
    if (!row.head.eligible || !person.eligible) {
      vacancies.push({ subjectId: row.subjectId, branch: row.branch, reason: "ineligible-owner" });
      continue;
    }
    if (!person.isNpc) {
      if (humanOwners.has(person.ownerId))
        throw new Error("A player cannot hold multiple Council mandates");
      humanOwners.add(person.ownerId);
    }
    seats.push({
      ...person,
      subjectId: row.subjectId,
      regionId: row.regionId,
      branch: row.branch,
      authorityRevision: row.revision,
      authorityPersonId: row.head.personId,
      ...(row.termEndTurn != null ? { termEndTurn: row.termEndTurn } : {}),
    });
  }
  return {
    seats,
    vacancies,
    viable: seats.length >= 90,
    seatsByParty: seats.reduce<Record<string, number>>((totals, row) => {
      totals[row.party] = (totals[row.party] ?? 0) + 1;
      return totals;
    }, {}),
  };
}
