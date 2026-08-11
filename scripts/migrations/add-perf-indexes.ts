/**
 * Migration: Add missing performance indexes.
 *
 * Adds compound indexes on hot read paths identified in the 2026-04-03 performance audit:
 * - bills: filter+sort for bill list endpoints
 * - notifications: per-user sort and unread count
 * - electionCandidates: lookup by electionId
 * - electionVoteTallies: lookup by electionId
 * - electedOfficials: lookup by characterId+officeType
 * - nppEndorsements: lookup by electionId+isActive
 * - primarySnapshots: electionId + recordedAt (desc: aggregations / latest; asc: history charts)
 * - npps: active NPP filter by retiredAt+countryId
 * - characters: politicians sort by countryId+politicalInfluence
 * - playerMail: unread mail count per user
 *
 * Idempotent — `createIndex` with a stable `name` is a no-op when the index
 * already exists (MongoDB returns "already exists"; the script handles that
 * silently).
 *
 * Two invocation modes:
 *   - via the migration framework registry: `npm run migrate`
 *   - standalone (legacy):                  `npx tsx scripts/migrations/add-perf-indexes.ts`
 */

import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import type { MigrationContext, MigrationResult } from "../../src/lib/migrations/types";

const INDEX_SPECS: ReadonlyArray<{
  collection: string;
  key: Record<string, 1 | -1>;
  name: string;
}> = [
  // bills — filter+sort compounds
  {
    collection: "bills",
    key: { countryId: 1, status: 1, proposedAt: -1 },
    name: "bills_countryId_status_proposedAt",
  },
  {
    collection: "bills",
    key: { countryId: 1, currentChamber: 1, status: 1, proposedAt: -1 },
    name: "bills_countryId_chamber_status_proposedAt",
  },
  { collection: "bills", key: { proposedAt: -1 }, name: "bills_proposedAt" },

  // notifications — per-user list and unread count
  {
    collection: "notifications",
    key: { userId: 1, createdAt: -1 },
    name: "notif_userId_createdAt",
  },
  { collection: "notifications", key: { userId: 1, read: 1 }, name: "notif_userId_read" },

  // electionCandidates — batch lookup by electionId
  { collection: "electionCandidates", key: { electionId: 1 }, name: "ec_electionId" },

  // electionVoteTallies — batch lookup by electionId
  { collection: "electionVoteTallies", key: { electionId: 1 }, name: "evt_electionId" },

  // electedOfficials — lookup a character's offices
  {
    collection: "electedOfficials",
    key: { characterId: 1, officeType: 1 },
    name: "eo_characterId_officeType",
  },

  // nppEndorsements — endorsements per election
  {
    collection: "nppEndorsements",
    key: { electionId: 1, isActive: 1 },
    name: "nppe_electionId_isActive",
  },

  // primarySnapshots — $match + $sort(recordedAt: -1) + $group; findOne(..., sort desc)
  {
    collection: "primarySnapshots",
    key: { electionId: 1, recordedAt: -1 },
    name: "ps_electionId_recordedAt",
  },
  {
    collection: "primarySnapshots",
    key: { electionId: 1, recordedAt: 1 },
    name: "ps_electionId_recordedAt_asc",
  },

  // npps — active NPP filter
  { collection: "npps", key: { retiredAt: 1, countryId: 1 }, name: "npps_retiredAt_countryId" },

  // characters — politicians list sort
  {
    collection: "characters",
    key: { countryId: 1, politicalInfluence: -1 },
    name: "chars_countryId_influence",
  },

  // playerMail — unread mail count (used in auth/me every page load)
  {
    collection: "playerMail",
    key: { toUserId: 1, read: 1, deletedByRecipient: 1 },
    name: "mail_toUserId_read_deleted",
  },
];

export async function runAddPerfIndexes(
  db: Db,
  opts: Pick<MigrationContext, "dryRun"> = { dryRun: false }
): Promise<MigrationResult> {
  const notes: string[] = [];
  let documentsUpdated = 0;

  for (const spec of INDEX_SPECS) {
    if (opts.dryRun) {
      notes.push(`[dry-run] would ensure index ${spec.collection}.${spec.name}`);
      continue;
    }
    try {
      await db.collection(spec.collection).createIndex(spec.key, { name: spec.name });
      notes.push(`✓ ${spec.collection}.${spec.name}`);
      documentsUpdated += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        notes.push(`= ${spec.collection}.${spec.name} (already exists)`);
      } else {
        notes.push(`✗ ${spec.collection}.${spec.name}: ${msg}`);
        throw err;
      }
    }
  }

  return { documentsUpdated, notes };
}

// Standalone CLI entrypoint (legacy invocation path).
async function main() {
  console.log("Adding performance indexes...");
  const db = await connectDb();
  try {
    const result = await runAddPerfIndexes(db, { dryRun: false });
    console.log("\nResults:");
    for (const note of result.notes ?? []) console.log(" ", note);
    console.log("\nDone.");
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  });
}
