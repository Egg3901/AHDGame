/**
 * Battle resolution order. Formations resolve by country and durable id so a
 * seeded battle produces the same per-unit losses regardless of Mongo read order.
 */

export function compareBattleUnits(
  a: { _id: unknown; countryId: string },
  b: { _id: unknown; countryId: string }
): number {
  return a.countryId.localeCompare(b.countryId) || String(a._id).localeCompare(String(b._id));
}
