import type { Db } from "mongodb";

export interface SeededCorporationIdentity {
  _id: unknown;
  sequentialId?: number | null;
  name?: string | null;
  countryId?: string | null;
}

export interface SequentialIdCollision {
  sequentialId: number;
  holders: Array<{ name: string; countryId: string; id: string }>;
}

/**
 * Group seeded corporations by sequentialId and return every id claimed by
 * more than one corporation. Pure (no DB access), so tests can pin the exact
 * issue #2028 duplicate groups without a database.
 *
 * Corporations without a sequentialId are ignored: the
 * `corporations_sequentialId` index is sparse, so those never collide.
 * Output is sorted by sequentialId (then holder name) so the diagnostic is
 * deterministic across runs.
 */
export function findDuplicateCorporationSequentialIds(
  corporations: SeededCorporationIdentity[]
): SequentialIdCollision[] {
  const bySeq = new Map<number, SequentialIdCollision["holders"]>();
  for (const corp of corporations) {
    if (corp.sequentialId == null) continue;
    const holders = bySeq.get(corp.sequentialId) ?? [];
    holders.push({
      name: corp.name ?? "(unnamed)",
      countryId: corp.countryId ?? "(no country)",
      id: String(corp._id),
    });
    bySeq.set(corp.sequentialId, holders);
  }
  return [...bySeq.entries()]
    .filter(([, holders]) => holders.length > 1)
    .map(([sequentialId, holders]) => ({
      sequentialId,
      holders: [...holders].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.sequentialId - b.sequentialId);
}

/** Render every collision as one actionable line per identifier. */
export function formatSequentialIdCollisions(collisions: SequentialIdCollision[]): string {
  return collisions
    .map(
      ({ sequentialId, holders }) =>
        `sequentialId ${sequentialId} claimed by ${holders.length}: ` +
        holders.map((h) => `"${h.name}" [${h.countryId}] (${h.id})`).join(", ")
    )
    .join("\n");
}

/**
 * Pre-index bootstrap invariant: enumerate every seeded corporation and fail
 * with ALL colliding identifiers (plus holder names and country context)
 * before `corporations_sequentialId` index creation is attempted. A bare
 * E11000 names only the first duplicate key; this names every one so a single
 * seed fix can close them all.
 *
 * Throws on any duplicate. Resolves silently when the collection is clean.
 */
export async function assertUniqueCorporationSequentialIds(db: Db): Promise<void> {
  const corporations = (await db
    .collection("corporations")
    .find({}, { projection: { sequentialId: 1, name: 1, countryId: 1 } })
    .toArray()) as SeededCorporationIdentity[];
  const collisions = findDuplicateCorporationSequentialIds(corporations);
  if (collisions.length > 0) {
    throw new Error(
      `Seeded corporations contain ${collisions.length} duplicate sequentialId(s); ` +
        `unique index corporations_sequentialId cannot be created:\n` +
        formatSequentialIdCollisions(collisions)
    );
  }
}
