/** Romanian electoral changes need both chamber majorities and an enacted bill. */
import { turnToGameMonth } from "@/lib/utils/gameDate";
export function ro1992DecisionAvailability(input: {
  preset?: string;
  calendarTurn: number;
  authorizedTurn?: number;
  completedTurn?: number;
  hasParliament?: boolean;
}) {
  if (input.preset !== "1991-default") return { available: false, reason: "other-era" };
  if (input.hasParliament === false) return { available: false, reason: "no-legislature" };
  if (!Number.isSafeInteger(input.calendarTurn) || input.calendarTurn < 1)
    throw new Error("Romanian electoral decisions need a valid calendar turn");
  if (input.completedTurn != null) return { available: false, reason: "existing-settlement" };
  if (input.authorizedTurn != null) return { available: false, reason: "already-authorized" };
  const date = turnToGameMonth(input.calendarTurn, 1991);
  // Law68 was promulgated in July1992. Original constitution articles72 and74.
  // https://www.cdep.ro/ords/pls/legis/legis_pck.htp_act_text?idt=12169
  if (date.year < 1992 || (date.year === 1992 && date.month < 6))
    return { available: false, reason: "before-date" };
  return { available: true, reason: "available" };
}
export function passesRoElectoralAmendment(
  totals: { for: number; against: number; abstain: number },
  seats: number
) {
  const values = [totals.for, totals.against, totals.abstain, seats];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || seats < 1) return false;
  const present = BigInt(totals.for) + BigInt(totals.against) + BigInt(totals.abstain);
  return present <= BigInt(seats) && BigInt(totals.for) * BigInt(2) > BigInt(seats);
}
