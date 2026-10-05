import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the conflicts collection:
 *
 *   - `conflictId` (unique, partial) — the public number that resolves
 *     /world/conflicts/<n>. Unique because two conflicts sharing a number would
 *     make one of them unreachable.
 *
 *     PARTIAL on `$exists` deliberately: Mongo treats a missing field as null, so a
 *     plain unique index cannot be built over two or more legacy conflicts written
 *     before `conflictId` existed. `ensureIndex` swallows a build failure into a
 *     warning, which would leave uniqueness silently unenforced — scoping the index
 *     to documents that actually carry the field removes that failure mode. Every
 *     document created since carries it (see createConflict + the backfill
 *     migration), so nothing real escapes the constraint.
 */
export async function seedConflictIndexes(db: Db, log: (msg: string) => void) {
  log("Conflict indexes:");

  await ensureIndex(
    db,
    "conflicts",
    { conflictId: 1 },
    {
      name: "conflicts_conflictId",
      unique: true,
      partialFilterExpression: { conflictId: { $exists: true } },
    },
    log
  );

  // A country's diplomacy panel lists live truces by membership in the
  // countries array and expiry turn. The pair-declaration path uses `_id` and
  // remains covered by Mongo's primary-key index.
  await ensureIndex(
    db,
    "truces",
    { countries: 1, expiresTurn: 1 },
    { name: "truces_country_expiry" },
    log
  );

  log("Conflict indexes ensured");
}
