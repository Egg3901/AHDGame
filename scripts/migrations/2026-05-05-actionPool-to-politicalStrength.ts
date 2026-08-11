/**
 * Phase 3 / Task 3.1 migration: rename `actionPool` → `politicalStrength`
 * on every existing `politicalParties` and `statePartyOrg` document.
 *
 * Per plan §"Phase 3 — Decisions Recorded During Execution" D1, this is a
 * single in-place rename — no parallel-field period, no staged alias.
 * Existing rows have an `actionPool: number` field; this script renames it
 * to `politicalStrength` and removes the old field. Rows that already lack
 * `actionPool` (newly created since Phase 3 schema landed) are left alone.
 *
 * Idempotent: re-running has no effect once every row is migrated.
 *
 * Usage:
 *   # Dry run against live DB (default, no writes):
 *   npx tsx scripts/migrations/2026-05-05-actionPool-to-politicalStrength.ts
 *
 *   # Apply for real:
 *   npx tsx scripts/migrations/2026-05-05-actionPool-to-politicalStrength.ts --apply
 *
 *   # Run against local DB instead:
 *   npx tsx scripts/migrations/2026-05-05-actionPool-to-politicalStrength.ts --db=local
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
    console.log(`Mode: ${dbMode.toUpperCase()}${apply ? " (APPLY)" : " (dry-run)"}`);

    for (const colName of ["politicalParties", "statePartyOrg"]) {
      const col = db.collection(colName);
      // Rows that still have the old field (definite migration candidates).
      const stale = await col.countDocuments({ actionPool: { $exists: true } });
      // Rows that already migrated (just for reporting).
      const alreadyRenamed = await col.countDocuments({
        politicalStrength: { $exists: true },
        actionPool: { $exists: false },
      });
      // Edge case: rows with BOTH set (should not occur in production but
      // could exist if a partial migration run was aborted). Report so the
      // operator can investigate before applying.
      const both = await col.countDocuments({
        actionPool: { $exists: true },
        politicalStrength: { $exists: true },
      });

      console.log(`[${colName}] stale=${stale} alreadyRenamed=${alreadyRenamed} both=${both}`);

      if (both > 0) {
        console.warn(
          `[${colName}] WARNING: ${both} row(s) have BOTH actionPool and politicalStrength. ` +
            `MongoDB $rename will overwrite politicalStrength with actionPool's value. ` +
            `Inspect these rows manually before running with --apply.`
        );
      }

      if (stale === 0) {
        console.log(`[${colName}] nothing to migrate.`);
        continue;
      }

      if (!apply) {
        console.log(
          `[${colName}] would rename actionPool→politicalStrength on ${stale} rows (dry-run).`
        );
        continue;
      }

      const result = await col.updateMany(
        { actionPool: { $exists: true } },
        { $rename: { actionPool: "politicalStrength" } }
      );
      console.log(`[${colName}] renamed ${result.modifiedCount} of ${stale} candidate rows.`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
