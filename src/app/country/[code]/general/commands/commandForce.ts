/**
 * Which of a country's units the Commanding General's page has to load.
 *
 * Two different questions are asked of the same list, and they do not have the
 * same answer:
 *
 *   - The command's ESTABLISHMENT is `command.unitIds` — what the defence seat
 *     put in this command. That is what the structure panel lists.
 *   - The force that actually ARRIVES at a front is every unit whose
 *     `assignedGeneralId` is a general this command posts, because `theaterOfUnit`
 *     resolves a unit's front from its general alone and never looks at which
 *     command holds it. That is what the per-general force shows.
 *
 * The two diverge in live data: a unit can sit in one command's `unitIds` while
 * being assigned to a general in another. Loading only the establishment made the
 * per-general force under-report — a general would be posted to a war with
 * divisions the page never showed.
 *
 * Extracted from the page body so the rule is testable; a server component cannot
 * be unit-tested in place.
 */
export function unitsForCommandPage<T extends { assignedGeneralId: string | null }>(
  units: T[],
  idOf: (unit: T) => string,
  command: { unitIds: string[]; commanderIds: string[] }
): T[] {
  const establishment = new Set(command.unitIds);
  const ownGenerals = new Set(command.commanderIds);
  return units.filter(
    (unit) =>
      establishment.has(idOf(unit)) ||
      (unit.assignedGeneralId !== null && ownGenerals.has(unit.assignedGeneralId))
  );
}
