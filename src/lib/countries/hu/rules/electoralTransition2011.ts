/**
 * Hungary's 2011 electoral law opens a parliamentary decision in December.
 * Approval selects the 106-constituency and 93-list system for later untouched
 * campaigns; a calendar date alone never changes an existing ballot.
 */
import { turnToGameMonth } from "@/lib/utils/gameDate";

export type HuAssemblyElectionSystem = "mixed-1989-v1" | "mixed-2011-v1";

export function hu2011DecisionAvailability(input: {
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
  const date = turnToGameMonth(input.calendarTurn, 1991);
  // Act CCIII was published on 30 December 2011 and entered into force in 2012.
  // https://njt.jog.gov.hu/jogszabaly/2011-203-00-00.0
  if (date.year < 2011 || (date.year === 2011 && date.month < 11))
    return { available: false, reason: "before-date" };
  return { available: true, reason: "available" };
}

/** An explicitly frozen law wins over subsequent approvals and calendar changes. */
export function huAssemblyElectionSystem(input: {
  calendarTurn: number;
  authorizedTurn?: number;
  legacyModernAssemblyYear?: number;
  frozenSystem?: HuAssemblyElectionSystem;
}): HuAssemblyElectionSystem {
  if (input.frozenSystem != null) {
    if (input.frozenSystem !== "mixed-1989-v1" && input.frozenSystem !== "mixed-2011-v1")
      throw new Error("Unknown Hungarian Assembly election system");
    return input.frozenSystem;
  }
  if (!Number.isSafeInteger(input.calendarTurn) || input.calendarTurn < 1)
    throw new Error("Hungarian campaign law needs a valid calendar turn");
  // Preserve a completed alternate-history settlement from an existing save.
  if (input.legacyModernAssemblyYear != null) return "mixed-2011-v1";
  if (input.authorizedTurn == null) return "mixed-1989-v1";
  if (!Number.isSafeInteger(input.authorizedTurn) || input.authorizedTurn < 1)
    throw new Error("Hungarian campaign law needs a valid authorization turn");
  return turnToGameMonth(input.calendarTurn, 1991).year >= 2012 ? "mixed-2011-v1" : "mixed-1989-v1";
}

/** Bounded NPC introduction requires a governing two-thirds parliamentary mandate. */
export function supportsHu2011NpcAmendment(governingSeats: number, totalSeats: number): boolean {
  return (
    Number.isSafeInteger(governingSeats) &&
    Number.isSafeInteger(totalSeats) &&
    totalSeats > 0 &&
    governingSeats > 0 &&
    governingSeats <= totalSeats &&
    BigInt(governingSeats) * BigInt(3) >= BigInt(totalSeats) * BigInt(2)
  );
}
