/**
 * Phase 6 / Task 6.8 audit follow-up: provision indexes for the new
 * `partyCharters` collection.
 *
 * Common query patterns the lifecycle commands + turn phase + cleanup-
 * immunity hook hit:
 *
 *   1. `foundersCharacterIds: <characterId>` — `/charters` list page
 *      filter ("charters where any of my characters is a founder").
 *   2. `(status, partyId)` — `cleanupEmptyParties` immunity lookup
 *      (`status ∈ {ratified, migrated, migrated-incomplete},
 *       partyId !== null`).
 *   3. `(partyId, countryId)` — migration script idempotency check
 *      + general per-party charter lookup.
 *   4. `(status, expiresAt)` and `(status, founderReplacementDeadline)`
 *      — per-turn `expireCharters` sweep.
 *   5. `(countryId, proposedName)` and `(countryId, proposedAbbr)` —
 *      uniqueness pre-checks in `draftCharter`.
 *
 * `createIndex` is idempotent in MongoDB when the key + options match,
 * so this migration is safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-05-06-add-charter-indexes.ts
 */
import { connectDb, closeDb } from "../utils/db";

async function migrate() {
  console.log("Adding partyCharters indexes...");
  const db = await connectDb();

  const results: string[] = [];

  async function ensure(
    key: Record<string, 1 | -1>,
    name: string,
    options: Record<string, unknown> = {}
  ) {
    try {
      await db.collection("partyCharters").createIndex(key, { name, ...options });
      results.push(`✓ partyCharters.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= partyCharters.${name} (already exists)`);
      } else {
        results.push(`✗ partyCharters.${name}: ${msg}`);
      }
    }
  }

  // (1) foundersCharacterIds — multi-key index (MongoDB indexes each
  //     array element). Replaces the old founders_userids index from
  //     the pre-character-id schema.
  await ensure({ foundersCharacterIds: 1 }, "founders_character_ids");

  // (2) status + partyId — cleanup-immunity hook composite.
  await ensure({ status: 1, partyId: 1 }, "status_partyid");

  // (3) partyId + countryId — direct lookup by chartered party.
  await ensure({ partyId: 1, countryId: 1 }, "partyid_countryid");

  // (4) status + expiresAt — `expireCharters` draft / pending sweep.
  await ensure({ status: 1, expiresAt: 1 }, "status_expiresat");

  // (4b) status + founderReplacementDeadline — `expireCharters`
  //      replacement-window sweep.
  await ensure({ status: 1, founderReplacementDeadline: 1 }, "status_founder_replacement_deadline");

  // (5) name + country uniqueness scope — `draftCharter` pre-check
  //     (case-insensitive collation so the regex check has support).
  await ensure({ countryId: 1, proposedName: 1 }, "countryid_proposedname", {
    collation: { locale: "en", strength: 2 },
  });

  // (5b) abbreviation + country uniqueness scope — `draftCharter`
  //     pre-check.
  await ensure({ countryId: 1, proposedAbbr: 1 }, "countryid_proposedabbr");

  console.log("\nResults:");
  for (const r of results) console.log(`  ${r}`);

  await closeDb();
}

migrate().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
