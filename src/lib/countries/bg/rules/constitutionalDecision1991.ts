/** Bulgaria adopts its constitution by two thirds of its entire constituent chamber. */
import { turnToGameMonth } from "@/lib/utils/gameDate";
export function bg1991DecisionAvailability(input: {
  preset?: string;
  calendarTurn: number;
  authorizedTurn?: number;
  completedTurn?: number;
  hasParliament?: boolean;
}) {
  if (input.preset !== "1991-default") return { available: false, reason: "other-era" };
  if (input.hasParliament === false) return { available: false, reason: "no-legislature" };
  if (!Number.isSafeInteger(input.calendarTurn) || input.calendarTurn < 1)
    throw new Error("Bulgarian electoral decisions need a valid calendar turn");
  if (input.completedTurn != null) return { available: false, reason: "existing-settlement" };
  if (input.authorizedTurn != null) return { available: false, reason: "already-authorized" };
  const date = turnToGameMonth(input.calendarTurn, 1991);
  // The founding constitution is governed by amended1971 Article143(3),
  // two thirds of all deputies. Later1991 Article161 is not retroactive.
  // https://www.parliament.bg/bg/19
  if (date.year === 1991 && date.month < 6) return { available: false, reason: "before-date" };
  return { available: true, reason: "available" };
}
export function passesBgConstitution1991(
  totals: { for: number; against: number; abstain: number },
  seats: number
) {
  const values = [totals.for, totals.against, totals.abstain, seats];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || seats < 1) return false;
  const present = BigInt(totals.for) + BigInt(totals.against) + BigInt(totals.abstain);
  return present <= BigInt(seats) && BigInt(totals.for) * BigInt(3) >= BigInt(seats) * BigInt(2);
}
