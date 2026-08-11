/**
 * One-time backfill: rewrite `expiresAt` on every existing financialTxLog
 * row to use the new 168-turn retention window.
 *
 * Pre-fix the application wrote `expiresAt = createdAt + 96h`. The Mongo TTL
 * index drops a doc as soon as `expiresAt` is in the past, so without this
 * backfill anything older than 96h that was about to drop will still drop —
 * we want the existing rows to live for 7 IRL days like the new ones.
 *
 * Idempotent: re-runs only widen `expiresAt` (never shorten), so executing
 * twice in the same window leaves data unchanged on the second pass.
 *
 * Run:
 *   MONGODB_URI=... npx tsx scripts/migrations/extend-tx-ttl-to-168-turns.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import { TX_TTL_TURNS, DEFAULT_TURN_LENGTH_MINUTES } from "../../src/lib/db/types/financialTxLog";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LIVE;
  if (!uri) {
    console.error("MONGODB_URI (or MONGODB_URI_LIVE) not set");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  const cfg = await db.collection("gameConfig").findOne({ _id: "default" } as never);
  const turnLength =
    (cfg as { turnLengthMinutes?: number } | null)?.turnLengthMinutes ??
    DEFAULT_TURN_LENGTH_MINUTES;
  const ttlMs = TX_TTL_TURNS * turnLength * 60_000;

  console.log(
    `Rewriting expiresAt for financialTxLog rows. TTL: ${TX_TTL_TURNS} turns × ${turnLength} min = ${ttlMs / 60_000} min total.`
  );

  // Use an aggregation pipeline update so we can compute per-row from createdAt.
  // Idempotent: $max preserves the longer of (existing expiresAt, new expiresAt).
  const result = await db.collection("financialTxLog").updateMany({}, [
    {
      $set: {
        expiresAt: {
          $max: ["$expiresAt", { $add: ["$createdAt", ttlMs] }],
        },
      },
    },
  ]);

  console.log(`Matched ${result.matchedCount}, modified ${result.modifiedCount}.`);

  await client.close();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
