import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";

/**
 * Which countries the per-turn approval snapshot has to cover.
 *
 * The snapshot used to run for `status === "active"` countries alone, but every
 * country in the game has a reachable approval page backed by full metrics and
 * demographics — so a country at war but not yet playable had no
 * `governmentApprovals` document at all, and its war block was computed nowhere,
 * stored nowhere and shown nowhere. Its page fell back to the live recompute in
 * `loadNationalApproval`, which by design carries none of the national
 * providers: no war, no address bump, no org statements, no cabinet.
 *
 * Pure set arithmetic, no database. The turn phase does the reads and hands the
 * results in, so the rules about who joins and who is released can be pinned by
 * tests rather than by prose.
 */

/** Distinct values, first occurrence wins, so callers get a stable order. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Countries on either roster of the given conflicts.
 *
 * `hostCountry` is deliberately NOT counted. `listConflictsForCountry` matches
 * on it, but `rosterSideOf` returns null for a host that is on neither side, so
 * its war block is permanently zero — pulling it in here would mint an approval
 * document every turn and release it again the next, forever. A host that is
 * also fighting appears on a roster and is picked up that way.
 */
export function belligerentsOf(conflicts: ConflictDoc[]): CountryId[] {
  return unique(
    conflicts.flatMap((conflict) => [
      ...((conflict.sideA?.countries ?? []) as CountryId[]),
      ...((conflict.sideB?.countries ?? []) as CountryId[]),
    ])
  );
}

export interface ApprovalSnapshotPlan {
  /** Every country to snapshot this turn, active countries first. */
  ids: CountryId[];
  /** The subset present only because of a war, which can later be released. */
  guests: CountryId[];
}

/**
 * The snapshot roster for one turn.
 *
 * `documented` is every country that already HAS an approval document. Keying on
 * the document existing, rather than on some property of its contents, is
 * load-bearing: a guest stays in the set until it is deliberately released, and
 * the ONE code path that deletes a guest's document only runs for countries that
 * are in the set.
 *
 * Keying on "still has exhaustion to heal" instead looked equivalent and was not.
 * A guest whose war ended on a turn its exhaustion happened to read exactly zero
 * — a country seeded at the one-year mark, or one that rallied to +1 and fought
 * exactly a year — fell out of the set the next turn with its document still on
 * disk and nothing left that would ever pick it up again. `loadNationalApproval`
 * prefers a stored rating over its live recompute, so that country's page would
 * have been pinned to its last wartime number for the rest of the game: exactly
 * the failure the release path exists to prevent.
 */
export function planApprovalSnapshot(
  activeIds: CountryId[],
  belligerents: CountryId[],
  documented: CountryId[],
  seededIds: CountryId[] = []
): ApprovalSnapshotPlan {
  const permanent = new Set([...activeIds, ...seededIds]);
  const guests = unique([...belligerents, ...documented]).filter((id) => !permanent.has(id));
  return { ids: unique([...activeIds, ...seededIds, ...guests]), guests };
}

/**
 * Guests whose `governmentApprovals` document should be dropped.
 *
 * This is the whole reason the guest list is tracked separately. A guest only
 * ever had a document because of a war, and `loadNationalApproval` prefers a
 * stored rating over its live recompute unconditionally — so a document left
 * behind after the war would pin that country's page to its last wartime number
 * for good. Releasing it puts the country back exactly where it was before the
 * war: no document, live recompute, same as every other country at peace.
 *
 * Keyed on stored EXHAUSTION rather than on the block total. Exhaustion is the
 * one war term that outlives its war, healing a point per in-game year, and this
 * document is the only place it lives — releasing while it is still negative
 * would delete the country's memory of the war and hand it the clean slate the
 * cooldown exists to deny. The block total rounds to a tenth for display and
 * would read zero while a real residue was still healing.
 *
 * A missing value counts as healed: there is nothing left to carry.
 */
export function guestsToRelease(
  guests: CountryId[],
  belligerents: CountryId[],
  exhaustion: Map<CountryId, number>
): CountryId[] {
  const fighting = new Set(belligerents);
  return guests.filter((id) => !fighting.has(id) && (exhaustion.get(id) ?? 0) === 0);
}
