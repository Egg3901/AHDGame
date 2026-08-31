import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";
import { ELECTION_WRITE_GUARD_INDEXES, GOVERNANCE_WRITE_GUARD_INDEXES } from "./writeGuardSpecs";

/**
 * Partial-unique indexes that block double-submit / double-vote races on
 * election entry, endorsements, governance votes, and cabinet/leadership
 * ballot rows.
 *
 * The specs themselves live in `writeGuardSpecs.ts` because the on-demand
 * `/api/admin/migrations/create-indexes` route creates the same set, and two
 * hand-maintained copies is how `embargoCooldowns` ended up with a different
 * index name in each path (#570, #591).
 *
 * Absorbs:
 *   - scripts/migrations/deprecated/add-election-write-guard-indexes.ts
 *   - scripts/migrations/deprecated/add-governance-write-guard-indexes.ts
 *
 * Both migrations are idempotent and become no-ops once these indexes are
 * present from bootstrap.
 */
export async function seedWriteGuardIndexes(db: Db, log: (msg: string) => void) {
  log("Election write-guard indexes:");
  for (const [collection, keys, options] of ELECTION_WRITE_GUARD_INDEXES) {
    await ensureIndex(db, collection, keys, options, log);
  }

  log("Governance write-guard indexes:");
  for (const [collection, keys, options] of GOVERNANCE_WRITE_GUARD_INDEXES) {
    await ensureIndex(db, collection, keys, options, log);
  }

  log("Write-guard indexes ensured");
}
