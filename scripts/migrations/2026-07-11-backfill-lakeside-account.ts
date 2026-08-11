/**
 * Backfill: stamp every existing user as a Lakeside Games account.
 *
 * A House Divided accounts and Lakeside Games accounts are the same user
 * record. New registrations are stamped at creation (see
 * src/lib/auth/lakesideAccount.ts); this backfills accounts that predate that
 * change so the whole `users` collection carries the marker.
 *
 * Sets `lakesideAccount: true` and `lakesideAccountSource: "ahd-backfill"` on
 * users missing the flag. Uses each user's existing `createdAt` as
 * `lakesideCreatedAt` (falling back to now) so the join date stays truthful.
 *
 * Idempotent: only touches users without `lakesideAccount`.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-07-11-backfill-lakeside-account.ts            # dry run (live)
 *   npx tsx scripts/migrations/2026-07-11-backfill-lakeside-account.ts --apply    # apply (live)
 *   npx tsx scripts/migrations/2026-07-11-backfill-lakeside-account.ts --db=local # local DB
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
  }
  dotenv.config();
  return null;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const envPath = loadEnvLocal();
  const dbMode = getArg("db") === "local" ? "local" : "live";
  const uriKey = dbMode === "local" ? "MONGODB_URI" : "MONGODB_URI_LIVE";
  const uri = process.env[uriKey];
  if (!uri) {
    throw new Error(
      `Missing ${uriKey}. Loaded env from ${envPath ?? "default dotenv resolution"}.`
    );
  }
  const apply = hasFlag("apply");

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    const users = db.collection("users");
    console.log(`Mode: ${dbMode.toUpperCase()}${apply ? " (APPLY)" : " (dry-run)"}`);

    const pending = await users.countDocuments({ lakesideAccount: { $exists: false } });
    const already = await users.countDocuments({ lakesideAccount: true });
    console.log(`Users needing backfill: ${pending}`);
    console.log(`Users already stamped:  ${already}`);

    if (!apply) {
      console.log("\nDry run only. Re-run with --apply to write.");
      return;
    }
    if (pending === 0) {
      console.log("\nNothing to backfill.");
      return;
    }

    // Set the flag/source for all, then set lakesideCreatedAt from each user's
    // own createdAt via an aggregation pipeline update so the date is truthful.
    const res = await users.updateMany({ lakesideAccount: { $exists: false } }, [
      {
        $set: {
          lakesideAccount: true,
          lakesideAccountSource: "ahd-backfill",
          lakesideCreatedAt: { $ifNull: ["$createdAt", "$$NOW"] },
        },
      },
    ]);
    console.log(`\nMatched ${res.matchedCount}, modified ${res.modifiedCount}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
