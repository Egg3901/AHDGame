/**
 * Reseeding a LIVE world is not a reset.
 *
 * `/api/admin/seed` and `/api/admin/setup` run their seeders against a database
 * that already holds play: party treasuries, elected chairs, member counts,
 * proposal-voted position shifts, chair-chosen colours, state Org built up over
 * hundreds of turns. A seeder that blanket-`$set`s its seed body over an
 * existing row destroys all of it — silently, with a normal success log. (A
 * genuine wipe is `resetGameWorld`'s job, and it deliberately deletes or
 * re-stamps instead.)
 *
 * The safe rule is structural rather than a field allow-list: **a seed fills
 * gaps and never overwrites**. Only keys the stored document does not have at
 * all are written; any key already present wins, whatever its value.
 *
 * Two properties follow, and they are the reason this is a rule and not a list:
 *
 * - It cannot clobber. Every field a seed carries is also written by gameplay
 *   somewhere, so no allow-list of "seed-owned" fields is actually safe.
 * - It cannot go stale. Adding a field to a seed needs no decision here: old
 *   rows gain it on the next reseed (so seed refreshes are not frozen), and
 *   rows that already have it keep their value.
 *
 * `null` counts as present. `chairId: null` is a real "nobody holds this"
 * value, not a gap, so a row that has been explicitly cleared is left alone.
 *
 * @param seed Seed body (without `_id` and other insert-time fields)
 * @param existing The stored document, read in full — a projected read would
 *   report present fields as gaps and reintroduce the clobber.
 * @returns Only the seed entries absent from `existing`; empty when there is
 *   nothing to fill, in which case the caller should skip the write entirely.
 */
export function fillAbsentSeedFields<T extends object>(seed: T, existing: object): Partial<T> {
  const gaps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(seed)) {
    if (!(key in existing)) gaps[key] = value;
  }
  return gaps as Partial<T>;
}
