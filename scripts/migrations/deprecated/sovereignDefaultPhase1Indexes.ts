/**
 * Phase 1 migration (sovereign default subsystem): add indexes needed by
 * later phases.
 *
 * Indexes:
 *   - federalBudget.sovereignCrisisState — for per-turn state-machine sweep
 *   - federalBudget.crisisAutoActionAt.realtimeMs — for 12h deadline sweep
 *   - federalBudget.crisisLegislativeDeadlineAt.realtimeMs — for legislative deadline sweep
 *   - federalBudget.imfBoardOverrideWindowEndAt.realtimeMs — for board window sweep
 *   - sovereignCrisisDecisions.{countryCode, state} — query open decisions per country
 *   - sovereignCrisisDecisions.firedAtRealtimeMs — chronological / deadline scans
 *
 * createIndex is idempotent in MongoDB — re-runs are no-ops via the `ensure`
 * helper which catches "already exists" errors.
 *
 * Usage: `MONGODB_URI=... npx tsx scripts/migrations/sovereignDefaultPhase1Indexes.ts`
 */

import { connectDb, closeDb } from "../../utils/db";

async function migrate() {
  console.log("[sovereign-default-phase1-indexes] Adding indexes...");
  const db = await connectDb();

  const results: string[] = [];

  async function ensure(
    collection: string,
    key: Record<string, 1 | -1>,
    name: string,
    options: { sparse?: boolean } = {}
  ) {
    try {
      await db.collection(collection).createIndex(key, { name, ...options });
      results.push(`✓ ${collection}.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= ${collection}.${name} (already exists)`);
      } else {
        results.push(`✗ ${collection}.${name}: ${msg}`);
      }
    }
  }

  // State-machine sweep — find countries in any non-normal state
  await ensure("federalBudget", { sovereignCrisisState: 1 }, "sovereignCrisisState_1");

  // 12-hour executive-decision deadline sweep — sparse since most rows have no pending crisis
  await ensure(
    "federalBudget",
    { "crisisAutoActionAt.realtimeMs": 1 },
    "crisisAutoActionAt_realtimeMs_1",
    { sparse: true }
  );

  // Legislative-deadline sweep — sparse for same reason
  await ensure(
    "federalBudget",
    { "crisisLegislativeDeadlineAt.realtimeMs": 1 },
    "crisisLegislativeDeadlineAt_realtimeMs_1",
    { sparse: true }
  );

  // IMF Board override window sweep — sparse for same reason
  await ensure(
    "federalBudget",
    { "imfBoardOverrideWindowEndAt.realtimeMs": 1 },
    "imfBoardOverrideWindowEndAt_realtimeMs_1",
    { sparse: true }
  );

  // sovereignCrisisDecisions — query open decisions per country
  await ensure("sovereignCrisisDecisions", { countryCode: 1, state: 1 }, "countryCode_state_1");

  // sovereignCrisisDecisions — chronological scans / deadline reconstruction
  await ensure("sovereignCrisisDecisions", { firedAtRealtimeMs: 1 }, "firedAtRealtimeMs_1");

  console.log(results.join("\n"));
  console.log("[sovereign-default-phase1-indexes] All indexes ensured.");

  await closeDb();
}

migrate().catch((err) => {
  console.error("[sovereign-default-phase1-indexes] FAILED:", err);
  process.exit(1);
});
