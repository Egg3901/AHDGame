/**
 * Creates indexes for the financialTxLog collection.
 *
 * Run once after deploying the financial transaction logging feature:
 *   npx tsx scripts/migrations/createFinancialTxLogIndexes.ts
 */

import { connectDb, closeDb } from "../../utils/db";

async function main() {
  const db = await connectDb();

  const col = db.collection("financialTxLog");

  // TTL: auto-expire when expiresAt elapses. Application now writes
  // expiresAt = createdAt + TX_TTL_TURNS × turnLengthMinutes × 60_000 (default
  // 168 turns × 60 min = 7 IRL days). The index itself is unchanged from the
  // original 96h schema — only the value emitters write has shifted.
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });

  // Cursor-based pagination (primary query pattern — already backed by _id, included for clarity)
  await col.createIndex({ _id: -1 }, { background: true });

  // Filter by flagged status (alerts query + flagged-only filter)
  await col.createIndex({ flagged: 1, _id: -1 }, { background: true });

  // Filter by subject (entity drilldown)
  await col.createIndex({ subjectId: 1, _id: -1 }, { sparse: true, background: true });
  await col.createIndex({ subjectType: 1, _id: -1 }, { background: true });

  // Filter by turn range
  await col.createIndex({ turn: -1 }, { background: true });

  // Filter by transaction type
  await col.createIndex({ type: 1, _id: -1 }, { background: true });

  // Text search on subject/counterparty name
  await col.createIndex({ subjectName: "text", counterpartyName: "text" }, { background: true });

  console.log("financialTxLog indexes created");

  await closeDb();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
