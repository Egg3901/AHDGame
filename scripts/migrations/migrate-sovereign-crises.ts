/**
 * Migration: Convert legacy sovereign-default decisions to the generalized
 * crisis interaction system.
 *
 * Reads open / executiveProposed `sovereignCrisisDecisions` and creates the
 * equivalent interactive `Crisis` + `CrisisInteraction` documents. Idempotent:
 * skips countries that already have an active "Sovereign Debt Crisis".
 *
 * Run: npx tsx scripts/migrations/migrate-sovereign-crises.ts
 */

import { connectDb, closeDb } from "../utils/db";
import { migrateSovereignDefaultToCrisisSystem } from "../../src/lib/crises/migrateSovereignDefault";

async function main() {
  const db = await connectDb();
  const result = await migrateSovereignDefaultToCrisisSystem(db);
  console.log("Sovereign crisis migration complete:", result);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
