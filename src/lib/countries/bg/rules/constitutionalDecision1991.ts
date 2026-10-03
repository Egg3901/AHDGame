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

export type Bg1991ConstituentDisposition = "dissolve" | "continue";
/** Existing drafts retain their original immediate-dissolution transition. */
export function bg1991ConstituentDisposition(
  value?: Bg1991ConstituentDisposition
): Bg1991ConstituentDisposition {
  if (value == null) return "dissolve";
  if (value !== "dissolve" && value !== "continue")
    throw new Error("Invalid Bulgarian constituent transition");
  return value;
}

/** The alternate continuation clause permits a later ordinary self-dissolution vote. */
export function passesBgContinuedAssemblyDissolution(
  totals: { for: number; against: number; abstain: number },
  capacity: number
): boolean {
  if (
    capacity !== 400 ||
    Object.values(totals).some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    return false;
  const present = BigInt(totals.for) + BigInt(totals.against) + BigInt(totals.abstain);
  return (
    present <= BigInt(capacity) &&
    present * BigInt(2) > BigInt(capacity) &&
    BigInt(totals.for) * BigInt(2) > present
  );
}

export function bgContinuedAssemblyDissolutionAvailability(input: {
  preset?: string;
  founding?: boolean;
  turn: number;
  constitutionTurn?: number;
  continuationTurn?: number;
  dissolutionTurn?: number;
  ordinaryTurn?: number;
  hasParliament?: boolean;
}) {
  if (input.preset !== "1991-default") return { available: false, reason: "other-era" };
  if (input.hasParliament === false) return { available: false, reason: "no-legislature" };
  if (!Number.isSafeInteger(input.turn) || input.turn < 1)
    throw new Error("Invalid Bulgarian dissolution turn");
  if (
    input.founding ||
    input.constitutionTurn == null ||
    input.continuationTurn == null ||
    !Number.isSafeInteger(input.constitutionTurn) ||
    input.constitutionTurn < 1 ||
    !Number.isSafeInteger(input.continuationTurn) ||
    input.continuationTurn < 1 ||
    input.constitutionTurn > input.turn ||
    input.continuationTurn > input.turn
  )
    return { available: false, reason: "not-continued" };
  if (input.dissolutionTurn != null || input.ordinaryTurn != null)
    return { available: false, reason: "already-dissolved" };
  return { available: true, reason: "available" };
}
