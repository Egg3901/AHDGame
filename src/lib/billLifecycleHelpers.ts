/**
 * Pure helpers for bill lifecycle logic.
 * Extracted for testability.
 */

/** Simple majority: votesFor > votesAgainst (abstains don't count). */
export function didPass(votesFor: number, votesAgainst: number): boolean {
  return votesFor > votesAgainst;
}

/** Chamber pair mappings — each chamber maps to its opposing chamber. */
const CHAMBER_PAIRS: Record<string, string> = {
  house: "senate",
  senate: "house",
  shugiin: "sangiin",
  sangiin: "shugiin",
};

/** The opposing chamber for a given chamber. */
export function otherChamber(chamber: string): string {
  return CHAMBER_PAIRS[chamber] ?? chamber;
}
