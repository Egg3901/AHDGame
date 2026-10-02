/**
 * Russian constitutional decisions open after their dates and Soviet succession.
 * russianConstitutionalDecisionAvailability keeps the presidency and replacement
 * Assembly independent, with elected offices requiring a separate certified vote.
 */
import { turnToGameMonth } from "@/lib/utils/gameDate";
export type RussianConstitutionalDecisionKind = "presidency" | "federalAssembly";

/** Article 185 of the 1991 RSFSR Constitution uses the full deputy capacity.
 * https://k.rsfsr.su/1978/7.pdf (printed page 70). Vacancies and abstentions
 * cannot lower the threshold for a constitutional change. */
export function passesRussianConstitutionalDecision(votesFor: number, seats: number): boolean {
  if (
    !Number.isSafeInteger(votesFor) ||
    votesFor < 0 ||
    !Number.isSafeInteger(seats) ||
    seats < 1 ||
    votesFor > seats
  )
    return false;
  return BigInt(votesFor) * BigInt(3) >= BigInt(seats) * BigInt(2);
}
export interface RussianConstitutionalDecisionState {
  ruSovietSuccessionSinceTurn?: number;
  ruPresidencySinceTurn?: number;
  ruPresidencyMandateSinceTurn?: number;
  ruFederalAssemblySinceTurn?: number;
  ruFederalAssemblyMandateSinceTurn?: number;
  ruCongressDissolvedSinceTurn?: number;
}
export function russianConstitutionalDecisionAvailability(input: {
  preset?: string;
  currentTurn: number;
  calendarTurn: number;
  kind: RussianConstitutionalDecisionKind;
  country: RussianConstitutionalDecisionState | null;
}): {
  available: boolean;
  reason:
    | "other-era"
    | "before-date"
    | "awaiting-succession"
    | "already-authorized"
    | "no-legislature"
    | "available";
} {
  const { preset, currentTurn, calendarTurn, kind, country } = input;
  if (preset !== "1991-default") return { available: false, reason: "other-era" };
  if (
    !Number.isSafeInteger(currentTurn) ||
    currentTurn < 1 ||
    !Number.isSafeInteger(calendarTurn) ||
    calendarTurn < 1
  )
    throw new Error("Russian constitutional decisions need valid raw and calendar turns");
  const { year, month } = turnToGameMonth(calendarTurn, 1991);
  // The presidency law was adopted on 24 April 1991. September 1993 opens
  // negotiation of a replacement Assembly, never an automatic dissolution.
  // https://www.prlib.ru/history/619190
  const dated =
    kind === "presidency"
      ? year > 1991 || (year === 1991 && month >= 3)
      : year > 1993 || (year === 1993 && month >= 8);
  if (!dated) return { available: false, reason: "before-date" };
  const succession = country?.ruSovietSuccessionSinceTurn;
  if (
    !Number.isSafeInteger(succession) ||
    !succession ||
    succession < 1 ||
    succession > currentTurn
  )
    return { available: false, reason: "awaiting-succession" };
  const authorized =
    kind === "presidency"
      ? (country?.ruPresidencyMandateSinceTurn ?? country?.ruPresidencySinceTurn)
      : (country?.ruFederalAssemblyMandateSinceTurn ?? country?.ruFederalAssemblySinceTurn);
  if (authorized != null) return { available: false, reason: "already-authorized" };
  if (country?.ruCongressDissolvedSinceTurn != null && country.ruFederalAssemblySinceTurn == null)
    return { available: false, reason: "no-legislature" };
  return { available: true, reason: "available" };
}
