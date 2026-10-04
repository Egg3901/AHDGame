/**
 * Certified Assembly winners retain their mandates only while eligible to serve.
 * applyRussianAssemblyOwnerEligibility records unavailable winners as vacancies,
 * preserves protected relocation choices and never promotes a losing nominee.
 */
import type { RussianAssemblySeat } from "./assemblySeating";
export interface RussianAssemblyOwnerStatus {
  ownerId: string;
  isNpc: boolean;
  countryId?: string;
  pendingRelocation: boolean;
  retired: boolean;
  isTechnocrat: boolean;
  incompatibleOffice: boolean;
}
export type RussianAssemblyVacancyReason =
  | "missing-owner"
  | "nonresident-owner"
  | "pending-relocation"
  | "retired-owner"
  | "technocrat-owner"
  | "incompatible-office";
export function applyRussianAssemblyOwnerEligibility(
  certified: readonly RussianAssemblySeat[],
  statuses: readonly RussianAssemblyOwnerStatus[]
) {
  const key = (row: { ownerId: string; isNpc: boolean }) =>
    `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
  const owners = new Map(statuses.map((row) => [key(row), row]));
  if (owners.size !== statuses.length)
    throw new Error("Assembly eligibility needs unique owner identities");
  const seats: RussianAssemblySeat[] = [];
  const vacancies: Array<RussianAssemblySeat & { reason: RussianAssemblyVacancyReason }> = [];
  for (const seat of certified) {
    const owner = owners.get(key(seat));
    const reason: RussianAssemblyVacancyReason | undefined = !owner
      ? "missing-owner"
      : owner.pendingRelocation
        ? "pending-relocation"
        : owner.countryId !== "RU"
          ? "nonresident-owner"
          : owner.retired
            ? "retired-owner"
            : owner.isTechnocrat
              ? "technocrat-owner"
              : owner.incompatibleOffice
                ? "incompatible-office"
                : undefined;
    if (reason) vacancies.push({ ...seat, reason });
    else seats.push(seat);
  }
  const seatsByParty: Record<string, number> = {};
  let dumaSeats = 0;
  let councilSeats = 0;
  for (const seat of seats)
    if (seat.officeType === "dumaDeputy") {
      dumaSeats += seat.seatsHeld;
      seatsByParty[seat.party] = (seatsByParty[seat.party] ?? 0) + seat.seatsHeld;
    } else councilSeats += seat.seatsHeld;
  return {
    seats,
    vacancies,
    seatsByParty,
    dumaSeats,
    councilSeats,
    dumaVacancies: 450 - dumaSeats,
    councilVacancies: 178 - councilSeats,
    // A replacement must be able to pass ordinary chamber decisions before
    // Congress is vacated. Vacancies never lower either constitutional majority.
    canReplaceCongress: dumaSeats >= 226 && councilSeats >= 90,
  };
}

/** The first chambers have two-year terms measured from their original polls. */
export function russianFirstAssemblyTermEndTurn(
  firstElectionTurns: readonly number[],
  turnsPerYear: number
) {
  if (
    !firstElectionTurns.length ||
    firstElectionTurns.some((turn) => !Number.isSafeInteger(turn) || turn < 1) ||
    !Number.isSafeInteger(turnsPerYear) ||
    turnsPerYear < 1
  )
    throw new Error("Assembly terms need safe original polls and calendar years");
  const end = Math.max(...firstElectionTurns) + 2 * turnsPerYear;
  if (!Number.isSafeInteger(end)) throw new Error("Assembly term exceeds turn precision");
  return end;
}

/** Transitional clause9 permits first-Duma deputies to serve in Government.
 * https://www.constitution.ru/en/10003000-10.htm
 */
export function russianFirstAssemblyOfficeCompatible(
  chamber: RussianAssemblySeat["officeType"],
  officeType: string | undefined,
  officeCountryId: string | undefined
) {
  if (!officeType) return true;
  if (officeCountryId !== "RU") return false;
  return (
    officeType === "congressDeputy" ||
    (chamber === "dumaDeputy" && ["primeMinister", "parliamentaryCabinet"].includes(officeType))
  );
}
