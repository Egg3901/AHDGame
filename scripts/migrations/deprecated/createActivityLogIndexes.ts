/**
 * Creates indexes for the activityLog and suspiciousCharacters collections.
 *
 * Run once after deploying the activity tracking feature:
 *   npx tsx scripts/migrations/createActivityLogIndexes.ts
 */

import { connectDb, closeDb } from "../../utils/db";

async function main() {
  const db = await connectDb();

  // ── activityLog ──────────────────────────────────────────────────────────────

  const activityLog = db.collection("activityLog");

  // TTL: auto-expire documents 30 days after timestamp
  await activityLog.createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 2592000, background: true }
  );

  // Query patterns
  await activityLog.createIndex({ userId: 1, timestamp: -1 }, { background: true });
  await activityLog.createIndex({ characterId: 1, timestamp: -1 }, { background: true });
  await activityLog.createIndex({ type: 1, timestamp: -1 }, { background: true });

  // Suspicious detection: IP grouping (sparse — only login events have ipAddress)
  await activityLog.createIndex(
    { ipAddress: 1, timestamp: -1 },
    { sparse: true, background: true }
  );
  await activityLog.createIndex(
    { trackingId: 1, timestamp: -1 },
    { sparse: true, background: true }
  );
  await activityLog.createIndex(
    { fingerprint: 1, timestamp: -1 },
    { sparse: true, background: true }
  );

  // Text search on username / characterName
  await activityLog.createIndex({ username: "text", characterName: "text" }, { background: true });

  // toId index for fund_concentration detection (toId + toType query)
  await activityLog.createIndex(
    { toId: 1, toType: 1, timestamp: -1 },
    { sparse: true, background: true }
  );

  console.log("activityLog indexes created");

  // ── suspiciousCharacters ─────────────────────────────────────────────────────

  const suspicious = db.collection("suspiciousCharacters");

  // Primary lookup by characterId (unique — _id == characterId, but keep for query patterns)
  await suspicious.createIndex({ characterId: 1 }, { unique: true, background: true });

  // Sort/filter queries
  await suspicious.createIndex(
    { dismissed: 1, highestSeverity: 1, flagCount: -1 },
    { background: true }
  );
  await suspicious.createIndex({ dismissed: 1, countryId: 1 }, { background: true });

  console.log("suspiciousCharacters indexes created");

  await closeDb();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
