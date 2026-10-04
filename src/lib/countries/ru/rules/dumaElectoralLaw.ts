/** Duma electoral laws require a dated parliamentary decision before future ballots change. */
import { turnToGameMonth } from "@/lib/utils/gameDate";

export type RussianDumaElectoralLaw = "decree1993" | "law1995";

export function passesRussianDumaLawChamber(
  totals: { for: number; against: number; abstain: number },
  seats: number
) {
  if (
    [totals.for, totals.against, totals.abstain, seats].some(
      (value) => !Number.isSafeInteger(value) || value < 0
    ) ||
    seats < 1
  )
    return false;
  const present = BigInt(totals.for) + BigInt(totals.against) + BigInt(totals.abstain);
  return present <= BigInt(seats) && BigInt(totals.for) * BigInt(2) > BigInt(seats);
}

export function russianDumaElectoralLaw(value?: RussianDumaElectoralLaw): RussianDumaElectoralLaw {
  if (value == null) return "decree1993";
  if (value !== "decree1993" && value !== "law1995")
    throw new Error("Unknown frozen Duma electoral law");
  return value;
}

export function russianDuma1995DecisionAvailability(input: {
  preset?: string;
  turn: number;
  calendarTurn: number;
  assemblySinceTurn?: number;
  enacted?: boolean;
  dissolved?: boolean;
}) {
  if (input.preset !== "1991-default") return { available: false, reason: "other-era" };
  if (
    !Number.isSafeInteger(input.turn) ||
    input.turn < 1 ||
    !Number.isSafeInteger(input.calendarTurn) ||
    input.calendarTurn < 1
  )
    throw new Error("Duma law decisions need valid turns");
  const { year, month } = turnToGameMonth(input.calendarTurn, 1991);
  // Original90-FZ is published in June1995. Its date opens a decision only.
  // https://www.kontur-extern.ru/info/normativ/document/1/15207-federalnyy-zakon-ot-21-06-95-n-90-fz
  if (year < 1995 || (year === 1995 && month < 5))
    return { available: false, reason: "before-date" };
  if (
    input.dissolved ||
    !Number.isSafeInteger(input.assemblySinceTurn) ||
    input.assemblySinceTurn! < 1 ||
    input.assemblySinceTurn! > input.turn
  )
    return { available: false, reason: "no-legislature" };
  if (input.enacted) return { available: false, reason: "already-authorized" };
  return { available: true, reason: "available" };
}
