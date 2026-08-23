import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the crisis interaction system:
 *
 *   - unique `crisisId` — one interaction document per crisis; the lookup on
 *     every active-for-character / interact request is a point query.
 *   - `resolvedAt + decisionDeadline` — the turn processor scans for unresolved
 *     interactions past their deadline to auto-resolve them.
 *   - `contributors.characterId` — guards the "already contributed" check on
 *     collective nodes.
 */
export async function seedCrisisInteractionIndexes(db: Db, log: (msg: string) => void) {
  log("Crisis interaction indexes:");

  await ensureIndex(
    db,
    "crisisInteractions",
    { crisisId: 1 },
    { name: "ci_crisisId", unique: true },
    log
  );

  await ensureIndex(
    db,
    "crisisInteractions",
    { resolvedAt: 1, decisionDeadline: 1 },
    { name: "ci_resolved_deadline" },
    log
  );

  await ensureIndex(
    db,
    "crisisInteractions",
    { "contributors.characterId": 1 },
    { name: "ci_contributor_character" },
    log
  );

  await ensureIndex(db, "crisisInteractions", { createdAt: -1 }, { name: "ci_createdAt" }, log);

  await ensureIndex(
    db,
    "crisisInteractions",
    { "leaderResponses.countryId": 1, resolvedAt: 1 },
    { name: "ci_leader_response_country", sparse: true },
    log
  );

  log("Crisis interaction indexes ensured");
}
