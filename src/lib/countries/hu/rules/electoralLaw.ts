/**
 * Hungarian electoral amendments require a quorate two-thirds parliamentary vote.
 * The 1994 amendment raises the strict list threshold and permitted slate size;
 * frozen ballots retain the law under which their voting began.
 */
import { turnToGameMonth } from "@/lib/utils/gameDate";
export type HuMixedElectoralLaw = "mixed-1989-v1" | "mixed-1994-v1";

export function huMixedElectoralLaw(law?: HuMixedElectoralLaw) {
  if (law != null && law !== "mixed-1989-v1" && law !== "mixed-1994-v1")
    throw new Error("Unknown Hungarian electoral law");
  return law === "mixed-1994-v1"
    ? { version: law, thresholdPercent: 5, listMultiplier: 3 }
    : { version: "mixed-1989-v1" as const, thresholdPercent: 4, listMultiplier: 2 };
}

export function hu1994DecisionAvailability(input: {
  preset?: string;
  calendarTurn: number;
  authorizedTurn?: number;
  modernAssemblyYear?: number;
  hasParliament?: boolean;
}) {
  if (input.preset !== "1991-default") return { available: false, reason: "other-era" };
  if (input.hasParliament === false) return { available: false, reason: "no-legislature" };
  if (!Number.isSafeInteger(input.calendarTurn) || input.calendarTurn < 1)
    throw new Error("Hungarian electoral decisions need a valid calendar turn");
  if (input.modernAssemblyYear != null) return { available: false, reason: "modern-law-in-force" };
  if (input.authorizedTurn != null) return { available: false, reason: "already-authorized" };
  // Act III was published on 20 January 1994; the game resolves monthly dates.
  // https://mkogy.jogtar.hu/jogszabaly?docid=99400003.TV
  if (turnToGameMonth(input.calendarTurn, 1991).year < 1994)
    return { available: false, reason: "before-date" };
  return { available: true, reason: "available" };
}

/** Bounded NPC mandate: a party above the proposed barrier may seek the change. */
export function supportsHu1994NpcAmendment(governingSeats: number): boolean {
  return (
    Number.isSafeInteger(governingSeats) &&
    governingSeats > 0 &&
    governingSeats <= 386 &&
    BigInt(governingSeats) * BigInt(100) > BigInt(386 * 5)
  );
}

/** Constitution sections 24(1) and 71(3), as amended in June 1990.
 * Abstention counts as attendance. No recorded vote counts as absence.
 * https://njt.jog.gov.hu/jogszabaly/1949-20-00-00
 * https://mkogy.jogtar.hu/jogszabaly?docid=99000040.TV (section 49). */
export function passesHuElectoralAmendment(
  totals: { for: number; against: number; abstain: number },
  seats: number
): boolean {
  const values = [totals.for, totals.against, totals.abstain, seats];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || seats < 1) return false;
  const present = BigInt(totals.for) + BigInt(totals.against) + BigInt(totals.abstain);
  return (
    present <= BigInt(seats) &&
    present * BigInt(2) > BigInt(seats) &&
    BigInt(totals.for) * BigInt(3) >= present * BigInt(2)
  );
}
